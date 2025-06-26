# Phase 4 Implementation Guide (Weeks 11-16)

## 4.1 Performance Optimization & Caching

### Redis Cache Implementation
```typescript
// api/src/services/cacheService.ts
import { createClient, RedisClientType } from 'redis';

export class CacheService {
  private client: RedisClientType;
  private defaultTTL = 3600; // 1 hour
  
  constructor(connectionString: string) {
    this.client = createClient({ url: connectionString });
    this.client.on('error', (err) => console.error('Redis Client Error', err));
  }
  
  async connect(): Promise<void> {
    await this.client.connect();
  }
  
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }
  
  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    try {
      await this.client.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }
  
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }
  
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.error('Cache invalidate error:', error);
    }
  }
  
  // Cache analytics data
  async cacheAnalytics(organizationId: string, timeRange: string, data: any): Promise<void> {
    const key = `analytics:${organizationId}:${timeRange}`;
    await this.set(key, data, 1800); // 30 minutes TTL
  }
  
  async getCachedAnalytics(organizationId: string, timeRange: string): Promise<any> {
    const key = `analytics:${organizationId}:${timeRange}`;
    return await this.get(key);
  }
  
  // Cache file metadata
  async cacheFileList(organizationId: string, filters: string, data: any): Promise<void> {
    const key = `files:${organizationId}:${filters}`;
    await this.set(key, data, 600); // 10 minutes TTL
  }
  
  async getCachedFileList(organizationId: string, filters: string): Promise<any> {
    const key = `files:${organizationId}:${filters}`;
    return await this.get(key);
  }
}
```

### CDN Integration for Static Assets
```typescript
// api/src/services/cdnService.ts
import { BlobServiceClient } from '@azure/storage-blob';

export class CDNService {
  private blobServiceClient: BlobServiceClient;
  private cdnEndpoint: string;
  
  constructor(storageConnectionString: string, cdnEndpoint: string) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
    this.cdnEndpoint = cdnEndpoint;
  }
  
  async uploadStaticAsset(fileName: string, content: Buffer, contentType: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient('static');
    await containerClient.createIfNotExists({ access: 'blob' });
    
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    await blockBlobClient.upload(content, content.length, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        blobCacheControl: 'public, max-age=31536000' // 1 year
      }
    });
    
    return `${this.cdnEndpoint}/static/${fileName}`;
  }
  
  async generateThumbnail(originalFileName: string, fileBuffer: Buffer): Promise<string | null> {
    // Generate thumbnail for supported file types
    if (this.isImageFile(originalFileName)) {
      const sharp = require('sharp');
      const thumbnail = await sharp(fileBuffer)
        .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      const thumbnailName = `thumbnails/${originalFileName.replace(/\.[^/.]+$/, '')}_thumb.jpg`;
      return await this.uploadStaticAsset(thumbnailName, thumbnail, 'image/jpeg');
    }
    
    return null;
  }
  
  private isImageFile(fileName: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return imageExtensions.includes(extension);
  }
}
```

### Database Query Optimization
```typescript
// api/src/services/optimizedCosmosService.ts
import { CosmosDbService } from './cosmosDbService';
import { CacheService } from './cacheService';

export class OptimizedCosmosService extends CosmosDbService {
  constructor(
    connectionString: string,
    databaseName: string,
    private cacheService: CacheService
  ) {
    super(connectionString, databaseName);
  }
  
  async listFilesOptimized(organizationId: string, options: any) {
    const cacheKey = this.generateCacheKey('files', organizationId, options);
    
    // Try cache first
    let result = await this.cacheService.get(cacheKey);
    if (result) {
      return result;
    }
    
    // Query database with optimized query
    const query = this.buildOptimizedQuery(organizationId, options);
    result = await this.executeOptimizedQuery(query);
    
    // Cache result
    await this.cacheService.set(cacheKey, result, 600); // 10 minutes
    
    return result;
  }
  
  private buildOptimizedQuery(organizationId: string, options: any): string {
    let query = `
      SELECT c.id, c.originalFileName, c.fileSize, c.fileType, 
             c.uploadedAt, c.uploadedBy, c.metadata, c.processingStatus
      FROM c 
      WHERE c.partitionKey = @organizationId 
        AND c.isDeleted = false
    `;
    
    // Add filters
    if (options.filter) {
      query += ` AND (CONTAINS(LOWER(c.originalFileName), LOWER(@filter)) 
                     OR CONTAINS(LOWER(c.metadata.company), LOWER(@filter)))`;
    }
    
    if (options.fileType) {
      query += ` AND c.fileType = @fileType`;
    }
    
    if (options.dateRange) {
      query += ` AND c.uploadedAt >= @startDate AND c.uploadedAt <= @endDate`;
    }
    
    // Add sorting
    query += ` ORDER BY c.${options.sortBy || 'uploadedAt'} ${options.sortOrder || 'DESC'}`;
    
    // Add pagination
    query += ` OFFSET ${options.skip || 0} LIMIT ${options.limit || 50}`;
    
    return query;
  }
  
  private generateCacheKey(prefix: string, organizationId: string, options: any): string {
    const optionsHash = Buffer.from(JSON.stringify(options)).toString('base64');
    return `${prefix}:${organizationId}:${optionsHash}`;
  }
}
```

## 4.2 Comprehensive Monitoring & Alerting

### Application Insights Enhanced Telemetry
```typescript
// api/src/monitoring/telemetryService.ts
import { TelemetryClient, CorrelationContext } from 'applicationinsights';

export class TelemetryService {
  private client: TelemetryClient;
  
  constructor(instrumentationKey: string) {
    const appInsights = require('applicationinsights');
    appInsights.setup(instrumentationKey)
      .setAutoDependencyCorrelation(true)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true)
      .setUseDiskRetryCaching(true)
      .start();
    
    this.client = appInsights.defaultClient;
  }
  
  // Custom metrics
  trackFileUpload(organizationId: string, fileSize: number, fileType: string, duration: number): void {
    this.client.trackEvent({
      name: 'FileUpload',
      properties: {
        organizationId,
        fileType,
        success: 'true'
      },
      measurements: {
        fileSize,
        duration
      }
    });
    
    this.client.trackMetric({
      name: 'FileUploadSize',
      value: fileSize,
      properties: { organizationId, fileType }
    });
    
    this.client.trackMetric({
      name: 'FileUploadDuration',
      value: duration,
      properties: { organizationId, fileType }
    });
  }
  
  trackFileProcessing(fileId: string, processingType: string, duration: number, success: boolean): void {
    this.client.trackEvent({
      name: 'FileProcessing',
      properties: {
        fileId,
        processingType,
        success: success.toString()
      },
      measurements: {
        duration
      }
    });
  }
  
  trackUserActivity(userId: string, organizationId: string, activity: string): void {
    this.client.trackEvent({
      name: 'UserActivity',
      properties: {
        userId,
        organizationId,
        activity
      }
    });
  }
  
  trackPerformanceMetric(name: string, value: number, properties?: any): void {
    this.client.trackMetric({
      name,
      value,
      properties
    });
  }
  
  trackError(error: Error, properties?: any): void {
    this.client.trackException({
      exception: error,
      properties
    });
  }
  
  // Custom availability test
  async trackAvailability(testName: string, testFunction: () => Promise<boolean>): Promise<void> {
    const startTime = Date.now();
    let success = false;
    let message = '';
    
    try {
      success = await testFunction();
      message = success ? 'Test passed' : 'Test failed';
    } catch (error) {
      message = error.message;
    }
    
    const duration = Date.now() - startTime;
    
    this.client.trackAvailability({
      name: testName,
      success,
      duration,
      message,
      runLocation: 'Azure Functions'
    });
  }
}
```

### Health Check Endpoints
```typescript
// api/src/functions/healthCheck.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { CosmosDbService } from '../services/cosmosDbService';
import { BlobStorageService } from '../services/blobStorageService';
import { CacheService } from '../services/cacheService';

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  details?: string;
}

app.http('healthCheck', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const checks: HealthCheckResult[] = [];
    let overallStatus = 'healthy';
    
    // Check Cosmos DB
    const cosmosCheck = await checkCosmosDB();
    checks.push(cosmosCheck);
    
    // Check Blob Storage
    const blobCheck = await checkBlobStorage();
    checks.push(blobCheck);
    
    // Check Redis Cache
    const cacheCheck = await checkCache();
    checks.push(cacheCheck);
    
    // Check Service Bus
    const serviceBusCheck = await checkServiceBus();
    checks.push(serviceBusCheck);
    
    // Determine overall status
    if (checks.some(check => check.status === 'unhealthy')) {
      overallStatus = 'unhealthy';
    } else if (checks.some(check => check.status === 'degraded')) {
      overallStatus = 'degraded';
    }
    
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;
    
    return {
      status: statusCode,
      jsonBody: {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks,
        version: process.env.APP_VERSION || '1.0.0'
      }
    };
  }
});

async function checkCosmosDB(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  try {
    // Simple query to test connectivity
    const cosmosService = new CosmosDbService(
      process.env.COSMOS_CONNECTION_STRING!,
      process.env.COSMOS_DATABASE_NAME!
    );
    
    await cosmosService.containers.files.items.query({
      query: 'SELECT TOP 1 c.id FROM c'
    }).fetchNext();
    
    return {
      service: 'CosmosDB',
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'CosmosDB',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      details: error.message
    };
  }
}

async function checkBlobStorage(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  try {
    const { BlobServiceClient } = require('@azure/storage-blob');
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AzureWebJobsStorage!
    );
    
    // List containers to test connectivity
    const iterator = blobServiceClient.listContainers();
    await iterator.next();
    
    return {
      service: 'BlobStorage',
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'BlobStorage',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      details: error.message
    };
  }
}

async function checkCache(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  try {
    const cacheService = new CacheService(process.env.REDIS_CONNECTION_STRING!);
    await cacheService.connect();
    
    // Test set and get
    const testKey = 'health-check';
    const testValue = { timestamp: Date.now() };
    await cacheService.set(testKey, testValue, 60);
    const retrieved = await cacheService.get(testKey);
    
    if (!retrieved || retrieved.timestamp !== testValue.timestamp) {
      throw new Error('Cache read/write test failed');
    }
    
    await cacheService.del(testKey);
    
    return {
      service: 'Redis',
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'Redis',
      status: 'degraded', // Cache failure is not critical
      responseTime: Date.now() - startTime,
      details: error.message
    };
  }
}

async function checkServiceBus(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  try {
    const { ServiceBusClient } = require('@azure/service-bus');
    const client = new ServiceBusClient(process.env.SERVICE_BUS_CONNECTION_STRING!);
    
    // Test connection by getting queue properties
    const queueName = process.env.PROCESSING_QUEUE_NAME!;
    const receiver = client.createReceiver(queueName);
    await receiver.close();
    await client.close();
    
    return {
      service: 'ServiceBus',
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      service: 'ServiceBus',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      details: error.message
    };
  }
}
```

### Alert Rules Configuration
```json
// monitoring/alert-rules.json
{
  "alertRules": [
    {
      "name": "High Error Rate",
      "description": "Alert when error rate exceeds 5% in 5 minutes",
      "condition": {
        "query": "requests | where success == false | summarize ErrorRate = (count() * 100.0) / toscalar(requests | count()) by bin(timestamp, 5m)",
        "threshold": 5,
        "operator": "GreaterThan",
        "timeAggregation": "Average",
        "windowSize": "PT5M"
      },
      "actions": [
        {
          "type": "email",
          "recipients": ["admin@company.com"]
        },
        {
          "type": "webhook",
          "url": "https://hooks.slack.com/services/..."
        }
      ]
    },
    {
      "name": "High Response Time",
      "description": "Alert when average response time exceeds 5 seconds",
      "condition": {
        "query": "requests | summarize AvgDuration = avg(duration) by bin(timestamp, 5m)",
        "threshold": 5000,
        "operator": "GreaterThan",
        "timeAggregation": "Average",
        "windowSize": "PT5M"
      }
    },
    {
      "name": "Storage Space Warning",
      "description": "Alert when blob storage usage exceeds 80%",
      "condition": {
        "query": "customMetrics | where name == 'StorageUsagePercent'",
        "threshold": 80,
        "operator": "GreaterThan"
      }
    },
    {
      "name": "Failed File Processing",
      "description": "Alert when file processing failure rate is high",
      "condition": {
        "query": "customEvents | where name == 'FileProcessing' and tostring(customDimensions.success) == 'false' | summarize FailureRate = count() by bin(timestamp, 10m)",
        "threshold": 10,
        "operator": "GreaterThan"
      }
    }
  ]
}
```

## 4.3 Security Enhancements

### Input Validation & Sanitization
```typescript
// api/src/security/inputValidator.ts
import Joi from 'joi';
import DOMPurify from 'isomorphic-dompurify';

export class InputValidator {
  private static fileUploadSchema = Joi.object({
    company: Joi.string().min(1).max(100).required().pattern(/^[a-zA-Z0-9\s\-_.]+$/),
    business_unit: Joi.string().min(1).max(50).required(),
    location: Joi.string().min(1).max(100).required(),
    time_period: Joi.string().min(1).max(20).required(),
    esg_topic: Joi.string().valid('Environment', 'Social', 'Governance').required(),
    esg_metric: Joi.string().min(1).max(100).required(),
    unit: Joi.string().min(1).max(20).required()
  });
  
  static validateFileUpload(data: any): { isValid: boolean; errors: string[] } {
    const { error } = this.fileUploadSchema.validate(data, { abortEarly: false });
    
    if (error) {
      return {
        isValid: false,
        errors: error.details.map(detail => detail.message)
      };
    }
    
    return { isValid: true, errors: [] };
  }
  
  static sanitizeInput(input: string): string {
    return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
  }
  
  static validateFileType(fileName: string, allowedTypes: string[]): boolean {
    const extension = fileName.toLowerCase().split('.').pop();
    return allowedTypes.includes(`.${extension}`);
  }
  
  static validateFileSize(size: number, maxSize: number): boolean {
    return size <= maxSize;
  }
  
  static detectMaliciousContent(fileBuffer: Buffer, fileName: string): boolean {
    // Basic malware detection patterns
    const maliciousPatterns = [
      /eval\s*\(/gi,
      /<script/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /onload\s*=/gi,
      /onerror\s*=/gi
    ];
    
    const content = fileBuffer.toString('utf8', 0, Math.min(fileBuffer.length, 10000));
    
    return maliciousPatterns.some(pattern => pattern.test(content));
  }
}
```

### Rate Limiting
```typescript
// api/src/middleware/rateLimiter.ts
import { CacheService } from '../services/cacheService';

export class RateLimiter {
  constructor(private cacheService: CacheService) {}
  
  async checkRateLimit(
    identifier: string, 
    windowMs: number, 
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Get current request count
    const requests = await this.cacheService.get<number[]>(key) || [];
    
    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    
    if (validRequests.length >= maxRequests) {
      const oldestRequest = Math.min(...validRequests);
      const resetTime = oldestRequest + windowMs;
      
      return {
        allowed: false,
        remaining: 0,
        resetTime
      };
    }
    
    // Add current request
    validRequests.push(now);
    await this.cacheService.set(key, validRequests, Math.ceil(windowMs / 1000));
    
    return {
      allowed: true,
      remaining: maxRequests - validRequests.length,
      resetTime: now + windowMs
    };
  }
  
  async checkUploadRateLimit(organizationId: string, userId: string): Promise<boolean> {
    // Different limits for different user types
    const orgLimit = await this.checkRateLimit(`org:${organizationId}`, 60000, 100); // 100 per minute per org
    const userLimit = await this.checkRateLimit(`user:${userId}`, 60000, 10); // 10 per minute per user
    
    return orgLimit.allowed && userLimit.allowed;
  }
}
```

## 4.4 Load Testing & Performance Optimization

### Load Testing Script
```javascript
// tests/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';

export let options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up
    { duration: '5m', target: 50 }, // Stay at 50 users
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% of requests under 5s
    http_req_failed: ['rate<0.05'], // Error rate under 5%
  },
};

const BASE_URL = 'https://your-app.azurestaticapps.net';

export default function() {
  // Test file upload
  const formData = new FormData();
  formData.append('file', http.file(generateTestFile(), 'test.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  formData.append('company', 'Test Company');
  formData.append('business_unit', 'IT');
  formData.append('location', 'New York');
  formData.append('time_period', '2024');
  formData.append('esg_topic', 'Environment');
  formData.append('esg_metric', 'Energy Consumption');
  formData.append('unit', 'kWh');
  
  const uploadResponse = http.post(`${BASE_URL}/api/storage`, formData.body(), {
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + formData.boundary,
      'Authorization': 'Bearer ' + getAuthToken()
    }
  });
  
  check(uploadResponse, {
    'upload status is 200': (r) => r.status === 200,
    'upload response time < 10s': (r) => r.timings.duration < 10000,
  });
  
  // Test file listing
  const listResponse = http.get(`${BASE_URL}/api/files`, {
    headers: {
      'Authorization': 'Bearer ' + getAuthToken()
    }
  });
  
  check(listResponse, {
    'list status is 200': (r) => r.status === 200,
    'list response time < 2s': (r) => r.timings.duration < 2000,
  });
  
  sleep(1);
}

function generateTestFile() {
  // Generate a simple test Excel file content
  return new Uint8Array([
    0x50, 0x4B, 0x03, 0x04, // ZIP signature
    // ... minimal Excel file structure
  ]);
}

function getAuthToken() {
  // Return test auth token
  return 'test-token';
}
```

## 4.5 Acceptance Criteria

### Performance Requirements
- [ ] API response time < 2 seconds for 95% of requests
- [ ] File upload processing < 30 seconds for 10MB files
- [ ] Dashboard loads within 3 seconds
- [ ] Support 100 concurrent users without degradation
- [ ] Cache hit rate > 80% for frequently accessed data

### Monitoring Requirements
- [ ] 99.9% uptime monitoring with alerts
- [ ] Error rate monitoring with < 1% threshold
- [ ] Performance metrics collection and alerting
- [ ] Health check endpoints responding correctly
- [ ] Comprehensive logging for troubleshooting

### Security Requirements
- [ ] Input validation on all endpoints
- [ ] Rate limiting implemented and tested
- [ ] File content scanning for malicious content
- [ ] HTTPS enforcement across all endpoints
- [ ] Security headers properly configured
