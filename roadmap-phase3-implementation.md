# Phase 3 Implementation Guide (Weeks 7-10)

## 3.1 Data Processing Pipeline

### Excel Data Extraction Service
```typescript
// api/src/services/excelProcessingService.ts
import * as XLSX from 'xlsx';
import { FileRecord } from '../models';

export interface ExcelProcessingResult {
  sheets: ExcelSheetData[];
  metadata: ExcelMetadata;
  errors: string[];
  warnings: string[];
}

export interface ExcelSheetData {
  name: string;
  data: any[][];
  headers: string[];
  rowCount: number;
  columnCount: number;
  charts?: ChartInfo[];
}

export interface ExcelMetadata {
  author?: string;
  title?: string;
  subject?: string;
  company?: string;
  createdDate?: Date;
  modifiedDate?: Date;
  sheetCount: number;
  hasFormulas: boolean;
  hasCharts: boolean;
}

export class ExcelProcessingService {
  async processExcelFile(fileBuffer: Buffer, fileRecord: FileRecord): Promise<ExcelProcessingResult> {
    try {
      const workbook = XLSX.read(fileBuffer, { 
        type: 'buffer',
        cellDates: true,
        cellNF: false,
        cellText: false
      });
      
      const result: ExcelProcessingResult = {
        sheets: [],
        metadata: this.extractMetadata(workbook),
        errors: [],
        warnings: []
      };
      
      // Process each sheet
      for (const sheetName of workbook.SheetNames) {
        try {
          const sheet = workbook.Sheets[sheetName];
          const sheetData = this.processSheet(sheet, sheetName);
          result.sheets.push(sheetData);
        } catch (error) {
          result.errors.push(`Error processing sheet "${sheetName}": ${error.message}`);
        }
      }
      
      // Validate ESG data if applicable
      if (fileRecord.metadata.esg_topic) {
        this.validateESGData(result);
      }
      
      return result;
    } catch (error) {
      throw new Error(`Failed to process Excel file: ${error.message}`);
    }
  }
  
  private processSheet(sheet: XLSX.WorkSheet, sheetName: string): ExcelSheetData {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const data: any[][] = [];
    const headers: string[] = [];
    
    // Extract headers (first row)
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
      const cell = sheet[cellAddress];
      headers.push(cell ? String(cell.v) : `Column${col + 1}`);
    }
    
    // Extract data rows
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const rowData: any[] = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[cellAddress];
        rowData.push(cell ? cell.v : null);
      }
      data.push(rowData);
    }
    
    return {
      name: sheetName,
      data,
      headers,
      rowCount: range.e.r - range.s.r,
      columnCount: range.e.c - range.s.c + 1,
      charts: this.extractCharts(sheet)
    };
  }
  
  private extractMetadata(workbook: XLSX.WorkBook): ExcelMetadata {
    const props = workbook.Props || {};
    
    return {
      author: props.Author,
      title: props.Title,
      subject: props.Subject,
      company: props.Company,
      createdDate: props.CreatedDate ? new Date(props.CreatedDate) : undefined,
      modifiedDate: props.ModifiedDate ? new Date(props.ModifiedDate) : undefined,
      sheetCount: workbook.SheetNames.length,
      hasFormulas: this.checkForFormulas(workbook),
      hasCharts: this.checkForCharts(workbook)
    };
  }
  
  private validateESGData(result: ExcelProcessingResult): void {
    // ESG-specific validation rules
    const esgMetrics = ['energy_consumption', 'carbon_emissions', 'water_usage', 'waste_generation'];
    
    result.sheets.forEach(sheet => {
      // Check for required ESG columns
      const hasMetricColumn = sheet.headers.some(header => 
        esgMetrics.some(metric => header.toLowerCase().includes(metric.replace('_', ' ')))
      );
      
      if (!hasMetricColumn) {
        result.warnings.push(`Sheet "${sheet.name}" may not contain ESG metric data`);
      }
      
      // Validate data types and ranges
      sheet.data.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (typeof cell === 'number' && cell < 0) {
            const header = sheet.headers[colIndex];
            if (esgMetrics.some(metric => header?.toLowerCase().includes(metric.replace('_', ' ')))) {
              result.warnings.push(`Negative value found in ${header} at row ${rowIndex + 2}`);
            }
          }
        });
      });
    });
  }
  
  private checkForFormulas(workbook: XLSX.WorkBook): boolean {
    return workbook.SheetNames.some(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      return Object.keys(sheet).some(key => {
        const cell = sheet[key];
        return cell && cell.f; // Cell has formula
      });
    });
  }
  
  private checkForCharts(workbook: XLSX.WorkBook): boolean {
    // Check for chart objects (implementation depends on XLSX version)
    return workbook.SheetNames.some(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      return sheet['!charts'] && sheet['!charts'].length > 0;
    });
  }
  
  private extractCharts(sheet: XLSX.WorkSheet): ChartInfo[] {
    // Extract chart information if available
    const charts: ChartInfo[] = [];
    
    if (sheet['!charts']) {
      sheet['!charts'].forEach((chart: any) => {
        charts.push({
          type: chart.type || 'unknown',
          title: chart.title || 'Untitled Chart',
          dataRange: chart.dataRange || '',
          position: chart.position || { x: 0, y: 0 }
        });
      });
    }
    
    return charts;
  }
}

interface ChartInfo {
  type: string;
  title: string;
  dataRange: string;
  position: { x: number; y: number };
}
```

### Async Processing with Service Bus
```typescript
// api/src/services/processingQueueService.ts
import { ServiceBusClient, ServiceBusSender, ServiceBusReceiver } from '@azure/service-bus';

export interface ProcessingJob {
  id: string;
  fileId: string;
  organizationId: string;
  jobType: 'excel_processing' | 'data_validation' | 'analytics_update';
  priority: 'low' | 'normal' | 'high';
  payload: any;
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
}

export class ProcessingQueueService {
  private client: ServiceBusClient;
  private sender: ServiceBusSender;
  private receiver: ServiceBusReceiver;
  
  constructor(connectionString: string, queueName: string) {
    this.client = new ServiceBusClient(connectionString);
    this.sender = this.client.createSender(queueName);
    this.receiver = this.client.createReceiver(queueName);
  }
  
  async enqueueJob(job: ProcessingJob): Promise<void> {
    await this.sender.sendMessages({
      body: job,
      messageId: job.id,
      contentType: 'application/json',
      timeToLive: 24 * 60 * 60 * 1000, // 24 hours
      scheduledEnqueueTime: job.priority === 'high' ? new Date() : new Date(Date.now() + 5000)
    });
  }
  
  async processJobs(handler: (job: ProcessingJob) => Promise<void>): Promise<void> {
    this.receiver.subscribe({
      processMessage: async (message) => {
        try {
          const job = message.body as ProcessingJob;
          await handler(job);
          await message.complete();
        } catch (error) {
          console.error('Job processing failed:', error);
          await message.abandon();
        }
      },
      processError: async (error) => {
        console.error('Queue processing error:', error);
      }
    });
  }
}
```

## 3.2 Real-time Analytics Dashboard

### Analytics Data Service
```typescript
// api/src/services/analyticsService.ts
import { CosmosDbService } from './cosmosDbService';
import { FileRecord } from '../models';

export interface AnalyticsData {
  overview: {
    totalFiles: number;
    totalSize: number;
    uploadsThisMonth: number;
    activeUsers: number;
  };
  fileTypes: { type: string; count: number; size: number }[];
  uploadTrends: { date: string; count: number; size: number }[];
  esgMetrics: ESGAnalytics;
  topUploaders: { userId: string; userName: string; count: number }[];
}

export interface ESGAnalytics {
  totalReports: number;
  topicDistribution: { topic: string; count: number }[];
  metricTrends: { metric: string; values: { date: string; value: number }[] }[];
  complianceScore: number;
}

export class AnalyticsService {
  constructor(private cosmosService: CosmosDbService) {}
  
  async generateAnalytics(organizationId: string, timeRange: {
    startDate: Date;
    endDate: Date;
  }): Promise<AnalyticsData> {
    const [overview, fileTypes, uploadTrends, esgMetrics, topUploaders] = await Promise.all([
      this.getOverviewStats(organizationId, timeRange),
      this.getFileTypeDistribution(organizationId, timeRange),
      this.getUploadTrends(organizationId, timeRange),
      this.getESGAnalytics(organizationId, timeRange),
      this.getTopUploaders(organizationId, timeRange)
    ]);
    
    return {
      overview,
      fileTypes,
      uploadTrends,
      esgMetrics,
      topUploaders
    };
  }
  
  private async getOverviewStats(organizationId: string, timeRange: any) {
    // Query for overview statistics
    const totalFilesQuery = `
      SELECT VALUE COUNT(1) 
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
    `;
    
    const totalSizeQuery = `
      SELECT VALUE SUM(c.fileSize) 
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
    `;
    
    const monthlyUploadsQuery = `
      SELECT VALUE COUNT(1) 
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
        AND c.uploadedAt >= @startDate
        AND c.uploadedAt <= @endDate
    `;
    
    const [totalFiles, totalSize, uploadsThisMonth] = await Promise.all([
      this.executeScalarQuery(totalFilesQuery, { orgId: organizationId }),
      this.executeScalarQuery(totalSizeQuery, { orgId: organizationId }),
      this.executeScalarQuery(monthlyUploadsQuery, { 
        orgId: organizationId, 
        startDate: timeRange.startDate,
        endDate: timeRange.endDate
      })
    ]);
    
    return {
      totalFiles: totalFiles || 0,
      totalSize: totalSize || 0,
      uploadsThisMonth: uploadsThisMonth || 0,
      activeUsers: 0 // TODO: Implement active users count
    };
  }
  
  private async getFileTypeDistribution(organizationId: string, timeRange: any) {
    const query = `
      SELECT c.fileType as type, COUNT(1) as count, SUM(c.fileSize) as size
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
        AND c.uploadedAt >= @startDate
        AND c.uploadedAt <= @endDate
      GROUP BY c.fileType
    `;
    
    return await this.executeQuery(query, {
      orgId: organizationId,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate
    });
  }
  
  private async getUploadTrends(organizationId: string, timeRange: any) {
    const query = `
      SELECT 
        DateTimeFromParts(
          DateTimePart("year", c.uploadedAt),
          DateTimePart("month", c.uploadedAt),
          DateTimePart("day", c.uploadedAt)
        ) as date,
        COUNT(1) as count,
        SUM(c.fileSize) as size
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
        AND c.uploadedAt >= @startDate
        AND c.uploadedAt <= @endDate
      GROUP BY DateTimeFromParts(
        DateTimePart("year", c.uploadedAt),
        DateTimePart("month", c.uploadedAt),
        DateTimePart("day", c.uploadedAt)
      )
      ORDER BY date
    `;
    
    return await this.executeQuery(query, {
      orgId: organizationId,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate
    });
  }
  
  private async getESGAnalytics(organizationId: string, timeRange: any): Promise<ESGAnalytics> {
    const topicQuery = `
      SELECT c.metadata.esg_topic as topic, COUNT(1) as count
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
        AND IS_DEFINED(c.metadata.esg_topic)
        AND c.uploadedAt >= @startDate
        AND c.uploadedAt <= @endDate
      GROUP BY c.metadata.esg_topic
    `;
    
    const topicDistribution = await this.executeQuery(topicQuery, {
      orgId: organizationId,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate
    });
    
    return {
      totalReports: topicDistribution.reduce((sum, item) => sum + item.count, 0),
      topicDistribution,
      metricTrends: [], // TODO: Implement metric trends
      complianceScore: 85 // TODO: Calculate actual compliance score
    };
  }
  
  private async getTopUploaders(organizationId: string, timeRange: any) {
    const query = `
      SELECT c.uploadedBy as userId, COUNT(1) as count
      FROM c 
      WHERE c.partitionKey = @orgId 
        AND c.isDeleted = false
        AND c.uploadedAt >= @startDate
        AND c.uploadedAt <= @endDate
      GROUP BY c.uploadedBy
      ORDER BY count DESC
      OFFSET 0 LIMIT 10
    `;
    
    const results = await this.executeQuery(query, {
      orgId: organizationId,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate
    });
    
    // TODO: Enrich with user names
    return results.map(item => ({
      ...item,
      userName: 'User Name' // TODO: Get actual user name
    }));
  }
  
  private async executeQuery(query: string, parameters: any): Promise<any[]> {
    const { resources } = await this.cosmosService.containers.files.items.query({
      query,
      parameters: Object.entries(parameters).map(([name, value]) => ({ name: `@${name}`, value }))
    }).fetchAll();
    
    return resources;
  }
  
  private async executeScalarQuery(query: string, parameters: any): Promise<any> {
    const results = await this.executeQuery(query, parameters);
    return results.length > 0 ? results[0] : null;
  }
}
```

### Real-time Dashboard Frontend
```javascript
// src/js/analytics.js
class AnalyticsDashboard {
  constructor() {
    this.charts = {};
    this.refreshInterval = 30000; // 30 seconds
    this.init();
  }
  
  async init() {
    await this.loadAnalytics();
    this.setupCharts();
    this.startAutoRefresh();
  }
  
  async loadAnalytics() {
    try {
      const response = await fetch('/api/analytics', {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load analytics');
      
      const data = await response.json();
      this.updateDashboard(data.data);
    } catch (error) {
      console.error('Analytics loading error:', error);
      this.showError('Failed to load analytics data');
    }
  }
  
  updateDashboard(data) {
    // Update overview cards
    document.getElementById('totalFiles').textContent = data.overview.totalFiles.toLocaleString();
    document.getElementById('totalSize').textContent = this.formatFileSize(data.overview.totalSize);
    document.getElementById('monthlyUploads').textContent = data.overview.uploadsThisMonth.toLocaleString();
    document.getElementById('activeUsers').textContent = data.overview.activeUsers.toLocaleString();
    
    // Update charts
    this.updateFileTypesChart(data.fileTypes);
    this.updateUploadTrendsChart(data.uploadTrends);
    this.updateESGMetricsChart(data.esgMetrics);
  }
  
  setupCharts() {
    // File types pie chart
    const fileTypesCtx = document.getElementById('fileTypesChart').getContext('2d');
    this.charts.fileTypes = new Chart(fileTypesCtx, {
      type: 'pie',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
          ]
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom'
          },
          title: {
            display: true,
            text: 'File Types Distribution'
          }
        }
      }
    });
    
    // Upload trends line chart
    const trendsCtx = document.getElementById('uploadTrendsChart').getContext('2d');
    this.charts.uploadTrends = new Chart(trendsCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Uploads',
          data: [],
          borderColor: '#36A2EB',
          backgroundColor: 'rgba(54, 162, 235, 0.1)',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Upload Trends'
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
  
  updateFileTypesChart(data) {
    this.charts.fileTypes.data.labels = data.map(item => item.type.toUpperCase());
    this.charts.fileTypes.data.datasets[0].data = data.map(item => item.count);
    this.charts.fileTypes.update();
  }
  
  updateUploadTrendsChart(data) {
    this.charts.uploadTrends.data.labels = data.map(item => 
      new Date(item.date).toLocaleDateString()
    );
    this.charts.uploadTrends.data.datasets[0].data = data.map(item => item.count);
    this.charts.uploadTrends.update();
  }
  
  updateESGMetricsChart(data) {
    // Update ESG-specific visualizations
    const esgContainer = document.getElementById('esgMetrics');
    esgContainer.innerHTML = `
      <div class="esg-overview">
        <div class="metric-card">
          <h4>Total ESG Reports</h4>
          <span class="metric-value">${data.totalReports}</span>
        </div>
        <div class="metric-card">
          <h4>Compliance Score</h4>
          <span class="metric-value">${data.complianceScore}%</span>
        </div>
      </div>
      <div class="esg-topics">
        ${data.topicDistribution.map(topic => `
          <div class="topic-item">
            <span class="topic-name">${topic.topic}</span>
            <div class="topic-bar">
              <div class="topic-fill" style="width: ${(topic.count / data.totalReports) * 100}%"></div>
            </div>
            <span class="topic-count">${topic.count}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  startAutoRefresh() {
    setInterval(() => {
      this.loadAnalytics();
    }, this.refreshInterval);
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  getAuthToken() {
    return localStorage.getItem('authToken');
  }
  
  showError(message) {
    // Show error notification
    const notification = document.createElement('div');
    notification.className = 'error-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
  new AnalyticsDashboard();
});
```

## 3.3 Acceptance Criteria

### Functional Requirements
- [ ] Excel files are parsed and data extracted successfully
- [ ] Async processing queue handles file processing jobs
- [ ] Real-time analytics dashboard displays current metrics
- [ ] ESG-specific analytics and compliance scoring
- [ ] Charts and visualizations update automatically

### Performance Requirements
- [ ] Excel processing completes within 30 seconds for files up to 10MB
- [ ] Analytics queries respond within 2 seconds
- [ ] Dashboard updates every 30 seconds
- [ ] Support for processing 100+ files concurrently

### Data Quality Requirements
- [ ] 99.9% accuracy in Excel data extraction
- [ ] Proper handling of formulas, charts, and formatting
- [ ] Data validation and error reporting
- [ ] ESG data compliance validation
