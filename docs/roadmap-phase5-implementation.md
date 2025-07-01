# Phase 5 Implementation Guide (Weeks 17-24)

## 5.1 Advanced Microsoft 365 Integrations

### Power BI Integration
```typescript
// api/src/integrations/powerBiService.ts
import { PowerBIApi } from 'powerbi-api';
import { AuthenticationContext } from 'adal-node';

export class PowerBIService {
  private powerBiApi: PowerBIApi;
  private authContext: AuthenticationContext;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private tenantId: string
  ) {
    this.authContext = new AuthenticationContext(`https://login.microsoftonline.com/${tenantId}`);
  }

  async getAccessToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.authContext.acquireTokenWithClientCredentials(
        'https://analysis.windows.net/powerbi/api',
        this.clientId,
        this.clientSecret,
        (err, tokenResponse) => {
          if (err) reject(err);
          else resolve(tokenResponse.accessToken);
        }
      );
    });
  }

  async createDataset(organizationId: string, esgData: any[]): Promise<string> {
    const token = await this.getAccessToken();

    const dataset = {
      name: `ESG Data - ${organizationId}`,
      tables: [{
        name: 'ESGMetrics',
        columns: [
          { name: 'Company', dataType: 'String' },
          { name: 'BusinessUnit', dataType: 'String' },
          { name: 'Location', dataType: 'String' },
          { name: 'TimePeriod', dataType: 'String' },
          { name: 'ESGTopic', dataType: 'String' },
          { name: 'ESGMetric', dataType: 'String' },
          { name: 'Value', dataType: 'Double' },
          { name: 'Unit', dataType: 'String' },
          { name: 'UploadedAt', dataType: 'DateTime' }
        ]
      }]
    };

    const response = await fetch('https://api.powerbi.com/v1.0/myorg/datasets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dataset)
    });

    const result = await response.json();
    return result.id;
  }

  async pushDataToPowerBI(datasetId: string, data: any[]): Promise<void> {
    const token = await this.getAccessToken();

    const rows = data.map(item => ({
      Company: item.metadata.company,
      BusinessUnit: item.metadata.business_unit,
      Location: item.metadata.location,
      TimePeriod: item.metadata.time_period,
      ESGTopic: item.metadata.esg_topic,
      ESGMetric: item.metadata.esg_metric,
      Value: item.processedData?.value || 0,
      Unit: item.metadata.unit,
      UploadedAt: item.uploadedAt
    }));

    await fetch(`https://api.powerbi.com/v1.0/myorg/datasets/${datasetId}/tables/ESGMetrics/rows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rows })
    });
  }

  async generateEmbedToken(datasetId: string, reportId: string): Promise<string> {
    const token = await this.getAccessToken();

    const response = await fetch(`https://api.powerbi.com/v1.0/myorg/reports/${reportId}/GenerateToken`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        accessLevel: 'View',
        datasetId: datasetId
      })
    });

    const result = await response.json();
    return result.token;
  }
}
```

### SharePoint Integration
```typescript
// api/src/integrations/sharePointService.ts
import { SPHttpClient, SPHttpClientResponse } from '@microsoft/sp-http';

export class SharePointService {
  private spHttpClient: SPHttpClient;
  private siteUrl: string;

  constructor(siteUrl: string, accessToken: string) {
    this.siteUrl = siteUrl;
    // Initialize SP HTTP client with access token
  }

  async uploadFileToSharePoint(
    fileName: string,
    fileContent: Buffer,
    libraryName: string = 'ESG Documents'
  ): Promise<string> {
    const uploadUrl = `${this.siteUrl}/_api/web/lists/getbytitle('${libraryName}')/RootFolder/Files/Add(url='${fileName}',overwrite=true)`;

    const response = await this.spHttpClient.post(uploadUrl, SPHttpClient.configurations.v1, {
      body: fileContent,
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Content-Type': 'application/octet-stream'
      }
    });

    const result = await response.json();
    return result.d.ServerRelativeUrl;
  }

  async createESGList(organizationId: string): Promise<void> {
    const listCreationUrl = `${this.siteUrl}/_api/web/lists`;

    const listDefinition = {
      '__metadata': { 'type': 'SP.List' },
      'AllowContentTypes': true,
      'BaseTemplate': 100,
      'ContentTypesEnabled': true,
      'Description': `ESG Data tracking for ${organizationId}`,
      'Title': `ESG_Data_${organizationId}`
    };

    await this.spHttpClient.post(listCreationUrl, SPHttpClient.configurations.v1, {
      body: JSON.stringify(listDefinition),
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose'
      }
    });

    // Add custom columns
    await this.addESGColumns(`ESG_Data_${organizationId}`);
  }

  private async addESGColumns(listTitle: string): Promise<void> {
    const columns = [
      { name: 'Company', type: 'Text' },
      { name: 'BusinessUnit', type: 'Text' },
      { name: 'ESGTopic', type: 'Choice', choices: ['Environment', 'Social', 'Governance'] },
      { name: 'ESGMetric', type: 'Text' },
      { name: 'MetricValue', type: 'Number' },
      { name: 'Unit', type: 'Text' },
      { name: 'ReportingPeriod', type: 'Text' }
    ];

    for (const column of columns) {
      await this.createListColumn(listTitle, column);
    }
  }

  private async createListColumn(listTitle: string, column: any): Promise<void> {
    const columnUrl = `${this.siteUrl}/_api/web/lists/getbytitle('${listTitle}')/Fields`;

    let fieldXml = '';
    switch (column.type) {
      case 'Text':
        fieldXml = `<Field Type='Text' DisplayName='${column.name}' Name='${column.name}' />`;
        break;
      case 'Number':
        fieldXml = `<Field Type='Number' DisplayName='${column.name}' Name='${column.name}' />`;
        break;
      case 'Choice':
        const choices = column.choices.map(choice => `<CHOICE>${choice}</CHOICE>`).join('');
        fieldXml = `<Field Type='Choice' DisplayName='${column.name}' Name='${column.name}'><CHOICES>${choices}</CHOICES></Field>`;
        break;
    }

    await this.spHttpClient.post(columnUrl, SPHttpClient.configurations.v1, {
      body: JSON.stringify({ '__metadata': { 'type': 'SP.Field' }, 'SchemaXml': fieldXml }),
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose'
      }
    });
  }
}
```

### Microsoft Teams Integration
```typescript
// api/src/integrations/teamsService.ts
import { Client } from '@microsoft/microsoft-graph-client';

export class TeamsService {
  private graphClient: Client;

  constructor(accessToken: string) {
    this.graphClient = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      }
    });
  }

  async sendFileUploadNotification(
    teamId: string,
    channelId: string,
    fileInfo: any
  ): Promise<void> {
    const message = {
      body: {
        contentType: 'html',
        content: `
          <h3>📊 New ESG File Uploaded</h3>
          <p><strong>File:</strong> ${fileInfo.originalFileName}</p>
          <p><strong>Company:</strong> ${fileInfo.metadata.company}</p>
          <p><strong>ESG Topic:</strong> ${fileInfo.metadata.esg_topic}</p>
          <p><strong>Uploaded by:</strong> ${fileInfo.uploadedBy}</p>
          <p><strong>Size:</strong> ${this.formatFileSize(fileInfo.fileSize)}</p>
          <p><a href="${fileInfo.url}">View File</a></p>
        `
      }
    };

    await this.graphClient
      .api(`/teams/${teamId}/channels/${channelId}/messages`)
      .post(message);
  }

  async createESGChannel(teamId: string, organizationName: string): Promise<string> {
    const channel = {
      displayName: `ESG Data - ${organizationName}`,
      description: 'Channel for ESG data uploads and discussions',
      membershipType: 'standard'
    };

    const response = await this.graphClient
      .api(`/teams/${teamId}/channels`)
      .post(channel);

    return response.id;
  }

  async shareFileToTeams(teamId: string, channelId: string, fileUrl: string, fileName: string): Promise<void> {
    const driveItem = {
      name: fileName,
      '@microsoft.graph.downloadUrl': fileUrl
    };

    await this.graphClient
      .api(`/teams/${teamId}/channels/${channelId}/filesFolder/children`)
      .post(driveItem);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
```

## 5.2 Enterprise Audit & Compliance

### Audit Trail Service
```typescript
// api/src/services/auditService.ts
import { CosmosDbService } from './cosmosDbService';

export interface AuditEvent {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  action: string;
  resourceType: 'file' | 'user' | 'organization' | 'settings';
  resourceId: string;
  details: any;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class AuditService {
  constructor(private cosmosService: CosmosDbService) {}

  async logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const auditEvent: AuditEvent = {
      ...event,
      id: this.generateId(),
      timestamp: new Date()
    };

    // Store in dedicated audit container
    await this.cosmosService.containers.audit.items.create(auditEvent);

    // Send to SIEM if critical
    if (event.severity === 'critical') {
      await this.sendToSIEM(auditEvent);
    }
  }

  async getAuditTrail(
    organizationId: string,
    filters: {
      userId?: string;
      action?: string;
      resourceType?: string;
      startDate?: Date;
      endDate?: Date;
      severity?: string;
    },
    pagination: { skip: number; limit: number }
  ): Promise<{ events: AuditEvent[]; totalCount: number }> {
    let query = `SELECT * FROM c WHERE c.organizationId = @organizationId`;
    const parameters = [{ name: '@organizationId', value: organizationId }];

    if (filters.userId) {
      query += ` AND c.userId = @userId`;
      parameters.push({ name: '@userId', value: filters.userId });
    }

    if (filters.action) {
      query += ` AND c.action = @action`;
      parameters.push({ name: '@action', value: filters.action });
    }

    if (filters.resourceType) {
      query += ` AND c.resourceType = @resourceType`;
      parameters.push({ name: '@resourceType', value: filters.resourceType });
    }

    if (filters.startDate) {
      query += ` AND c.timestamp >= @startDate`;
      parameters.push({ name: '@startDate', value: filters.startDate });
    }

    if (filters.endDate) {
      query += ` AND c.timestamp <= @endDate`;
      parameters.push({ name: '@endDate', value: filters.endDate });
    }

    if (filters.severity) {
      query += ` AND c.severity = @severity`;
      parameters.push({ name: '@severity', value: filters.severity });
    }

    query += ` ORDER BY c.timestamp DESC`;
    query += ` OFFSET ${pagination.skip} LIMIT ${pagination.limit}`;

    const { resources } = await this.cosmosService.containers.audit.items.query({
      query,
      parameters
    }).fetchAll();

    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT VALUE COUNT(1)').split('ORDER BY')[0];
    const { resources: countResult } = await this.cosmosService.containers.audit.items.query({
      query: countQuery,
      parameters: parameters.filter(p => !p.name.includes('skip') && !p.name.includes('limit'))
    }).fetchAll();

    return {
      events: resources as AuditEvent[],
      totalCount: countResult[0] || 0
    };
  }

  async generateComplianceReport(
    organizationId: string,
    reportType: 'SOX' | 'GDPR' | 'ISO27001' | 'ESG',
    timeRange: { startDate: Date; endDate: Date }
  ): Promise<any> {
    const auditEvents = await this.getAuditTrail(organizationId, {
      startDate: timeRange.startDate,
      endDate: timeRange.endDate
    }, { skip: 0, limit: 10000 });

    switch (reportType) {
      case 'SOX':
        return this.generateSOXReport(auditEvents.events);
      case 'GDPR':
        return this.generateGDPRReport(auditEvents.events);
      case 'ISO27001':
        return this.generateISO27001Report(auditEvents.events);
      case 'ESG':
        return this.generateESGReport(auditEvents.events);
      default:
        throw new Error(`Unsupported report type: ${reportType}`);
    }
  }

  private generateSOXReport(events: AuditEvent[]): any {
    return {
      reportType: 'SOX Compliance',
      generatedAt: new Date(),
      summary: {
        totalEvents: events.length,
        criticalEvents: events.filter(e => e.severity === 'critical').length,
        dataAccessEvents: events.filter(e => e.action.includes('access')).length,
        dataModificationEvents: events.filter(e => e.action.includes('modify') || e.action.includes('delete')).length
      },
      sections: {
        accessControls: this.analyzeAccessControls(events),
        dataIntegrity: this.analyzeDataIntegrity(events),
        changeManagement: this.analyzeChangeManagement(events)
      }
    };
  }

  private async sendToSIEM(event: AuditEvent): Promise<void> {
    // Send to Security Information and Event Management system
    // Implementation depends on your SIEM solution
    console.log('Critical audit event:', event);
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private analyzeAccessControls(events: AuditEvent[]): any {
    // Analyze access control events for SOX compliance
    return {
      unauthorizedAccess: events.filter(e => e.action === 'unauthorized_access').length,
      privilegedAccess: events.filter(e => e.action === 'admin_access').length,
      failedLogins: events.filter(e => e.action === 'login_failed').length
    };
  }

  private analyzeDataIntegrity(events: AuditEvent[]): any {
    return {
      dataModifications: events.filter(e => e.action.includes('modify')).length,
      dataDeletions: events.filter(e => e.action.includes('delete')).length,
      backupEvents: events.filter(e => e.action.includes('backup')).length
    };
  }

  private analyzeChangeManagement(events: AuditEvent[]): any {
    return {
      configurationChanges: events.filter(e => e.action.includes('config')).length,
      systemUpdates: events.filter(e => e.action.includes('update')).length,
      userChanges: events.filter(e => e.resourceType === 'user').length
    };
  }

  private generateGDPRReport(events: AuditEvent[]): any {
    // GDPR-specific compliance report
    return {
      reportType: 'GDPR Compliance',
      dataProcessingActivities: events.filter(e => e.action.includes('process')),
      dataSubjectRequests: events.filter(e => e.action.includes('data_subject')),
      dataBreaches: events.filter(e => e.severity === 'critical' && e.action.includes('breach'))
    };
  }

  private generateISO27001Report(events: AuditEvent[]): any {
    // ISO 27001 compliance report
    return {
      reportType: 'ISO 27001 Compliance',
      securityEvents: events.filter(e => e.severity === 'high' || e.severity === 'critical'),
      accessManagement: events.filter(e => e.action.includes('access')),
      incidentManagement: events.filter(e => e.action.includes('incident'))
    };
  }

  private generateESGReport(events: AuditEvent[]): any {
    // ESG-specific compliance report
    return {
      reportType: 'ESG Data Governance',
      dataUploads: events.filter(e => e.action === 'file_upload'),
      dataValidation: events.filter(e => e.action.includes('validation')),
      reportingActivities: events.filter(e => e.action.includes('report'))
    };
  }
}
```