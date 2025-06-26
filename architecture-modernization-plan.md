# Architecture Modernization & Deployment Strategy

## 4. Architecture Modernization Recommendations

### 4.1 Code Structure & Organization

#### Current Structure Analysis
```
my-first-static-web-app2/
├── api/
│   ├── index.js (monolithic function)
│   ├── package.json
│   └── local.settings.json
├── src/
│   ├── index.html (single large file)
│   └── styles.css
└── test files
```

#### Recommended Modular Structure
```
my-first-static-web-app2/
├── api/
│   ├── src/
│   │   ├── functions/
│   │   │   ├── fileUpload.ts
│   │   │   ├── fileManagement.ts
│   │   │   ├── analytics.ts
│   │   │   ├── auth.ts
│   │   │   └── healthCheck.ts
│   │   ├── services/
│   │   │   ├── cosmosDbService.ts
│   │   │   ├── blobStorageService.ts
│   │   │   ├── cacheService.ts
│   │   │   ├── auditService.ts
│   │   │   └── processingQueueService.ts
│   │   ├── models/
│   │   │   ├── fileRecord.ts
│   │   │   ├── user.ts
│   │   │   └── organization.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── errorHandler.ts
│   │   │   ├── rateLimiter.ts
│   │   │   └── validator.ts
│   │   ├── utils/
│   │   │   ├── logger.ts
│   │   │   ├── config.ts
│   │   │   └── helpers.ts
│   │   └── types/
│   │       ├── api.ts
│   │       └── common.ts
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── e2e/
│   ├── package.json
│   ├── tsconfig.json
│   └── jest.config.js
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileUploader/
│   │   │   ├── Dashboard/
│   │   │   ├── Analytics/
│   │   │   └── Common/
│   │   ├── services/
│   │   │   ├── apiService.ts
│   │   │   ├── authService.ts
│   │   │   └── cacheService.ts
│   │   ├── utils/
│   │   │   ├── formatters.ts
│   │   │   ├── validators.ts
│   │   │   └── constants.ts
│   │   ├── styles/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   └── globals.css
│   │   ├── types/
│   │   │   └── api.ts
│   │   └── pages/
│   │       ├── upload.html
│   │       ├── dashboard.html
│   │       └── analytics.html
│   ├── public/
│   │   ├── icons/
│   │   ├── images/
│   │   └── manifest.json
│   ├── tests/
│   ├── webpack.config.js
│   ├── package.json
│   └── tsconfig.json
├── infrastructure/
│   ├── bicep/
│   │   ├── main.bicep
│   │   ├── modules/
│   │   └── parameters/
│   ├── arm-templates/
│   └── scripts/
├── docs/
│   ├── api/
│   ├── user-guides/
│   └── deployment/
└── .github/
    └── workflows/
        ├── ci-cd.yml
        ├── security-scan.yml
        └── performance-test.yml
```

### 4.2 TypeScript Migration Strategy

#### Phase 1: API Migration (Week 1)
```typescript
// api/src/types/common.ts
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    skip: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
}

export interface FileUploadRequest {
  file: File;
  metadata: UploadMetadata;
}

export interface UploadMetadata {
  company: string;
  business_unit: string;
  location: string;
  time_period: string;
  esg_topic: 'Environment' | 'Social' | 'Governance';
  esg_metric: string;
  unit: string;
}
```

#### Phase 2: Frontend Migration (Week 2)
```typescript
// frontend/src/services/apiService.ts
export class ApiService {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async uploadFile(file: File, metadata: UploadMetadata): Promise<ApiResponse<FileRecord>> {
    const formData = new FormData();
    formData.append('file', file);
    
    Object.entries(metadata).forEach(([key, value]) => {
      formData.append(key, value);
    });

    return this.request<FileRecord>('/api/storage', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    });
  }

  async getFiles(options: FileListOptions = {}): Promise<PaginatedResponse<FileRecord>> {
    const params = new URLSearchParams();
    
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString());
      }
    });

    return this.request<FileRecord[]>(`/api/files?${params}`);
  }

  async deleteFile(fileId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  async getAnalytics(timeRange?: string): Promise<ApiResponse<AnalyticsData>> {
    const params = timeRange ? `?timeRange=${timeRange}` : '';
    return this.request<AnalyticsData>(`/api/analytics${params}`);
  }
}
```

### 4.3 Database Strategy

#### Azure Cosmos DB Configuration
```json
{
  "cosmosDb": {
    "accountName": "esg-data-cosmos",
    "databaseName": "ESGDataPlatform",
    "containers": [
      {
        "name": "files",
        "partitionKey": "/organizationId",
        "throughput": 1000,
        "indexingPolicy": {
          "indexingMode": "consistent",
          "includedPaths": [
            { "path": "/organizationId/?" },
            { "path": "/uploadedAt/?" },
            { "path": "/fileType/?" },
            { "path": "/metadata/company/?" },
            { "path": "/metadata/esg_topic/?" }
          ],
          "excludedPaths": [
            { "path": "/processedData/*" }
          ]
        }
      },
      {
        "name": "organizations",
        "partitionKey": "/id",
        "throughput": 400
      },
      {
        "name": "users",
        "partitionKey": "/organizationId",
        "throughput": 400
      },
      {
        "name": "audit",
        "partitionKey": "/organizationId",
        "throughput": 800,
        "timeToLive": 2592000
      }
    ]
  }
}
```

#### Data Migration Strategy
```typescript
// scripts/migrate-data.ts
import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient } from '@azure/storage-blob';

export class DataMigrationService {
  async migrateExistingFiles(): Promise<void> {
    // 1. Scan existing blob storage
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AzureWebJobsStorage!
    );
    
    const containerClient = blobServiceClient.getContainerClient('upload');
    
    // 2. Create file records for existing blobs
    for await (const blob of containerClient.listBlobsFlat()) {
      const fileRecord = await this.createFileRecordFromBlob(blob);
      await this.cosmosService.createFileRecord(fileRecord);
    }
  }

  private async createFileRecordFromBlob(blob: any): Promise<FileRecord> {
    // Extract metadata from blob properties and create file record
    return {
      id: this.generateId(),
      partitionKey: blob.metadata?.organizationId || 'default',
      originalFileName: blob.metadata?.originalFilename || blob.name,
      storedFileName: blob.name,
      fileSize: blob.properties.contentLength,
      fileType: this.getFileTypeFromName(blob.name),
      mimeType: blob.properties.contentType,
      blobUrl: `https://storage.blob.core.windows.net/upload/${blob.name}`,
      uploadedBy: blob.metadata?.uploadedBy || 'system',
      uploadedAt: blob.properties.lastModified,
      metadata: this.parseMetadataFromBlob(blob.metadata),
      processingStatus: 'pending',
      tags: [],
      isDeleted: false
    };
  }
}
```

### 4.4 Performance Optimization

#### Caching Strategy
```typescript
// api/src/config/cacheConfig.ts
export const cacheConfig = {
  redis: {
    connectionString: process.env.REDIS_CONNECTION_STRING,
    keyPrefix: 'esg-app:',
    defaultTTL: 3600, // 1 hour
  },
  strategies: {
    fileList: {
      ttl: 600, // 10 minutes
      pattern: 'files:*',
    },
    analytics: {
      ttl: 1800, // 30 minutes
      pattern: 'analytics:*',
    },
    userProfile: {
      ttl: 7200, // 2 hours
      pattern: 'user:*',
    },
    organizationSettings: {
      ttl: 14400, // 4 hours
      pattern: 'org:*',
    },
  },
};
```

#### CDN Configuration
```json
{
  "cdn": {
    "endpoint": "https://esg-app-cdn.azureedge.net",
    "originUrl": "https://esg-app-storage.blob.core.windows.net",
    "cachingRules": [
      {
        "path": "/static/*",
        "cacheDuration": "1.00:00:00",
        "queryStringCaching": "IgnoreQueryString"
      },
      {
        "path": "/api/*",
        "cacheDuration": "00:05:00",
        "queryStringCaching": "UseQueryString"
      }
    ],
    "compressionSettings": {
      "contentTypesToCompress": [
        "text/plain",
        "text/html",
        "text/css",
        "application/javascript",
        "application/json"
      ]
    }
  }
}
```

### 4.5 Scalability Architecture

#### Azure Functions Premium Plan Configuration
```json
{
  "functionApp": {
    "plan": "Premium",
    "sku": "EP1",
    "settings": {
      "FUNCTIONS_WORKER_RUNTIME": "node",
      "WEBSITE_NODE_DEFAULT_VERSION": "~18",
      "FUNCTIONS_EXTENSION_VERSION": "~4",
      "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING": "...",
      "WEBSITE_CONTENTSHARE": "esg-app-content",
      "WEBSITE_RUN_FROM_PACKAGE": "1",
      "WEBSITE_ENABLE_SYNC_UPDATE_SITE": "true"
    },
    "scaling": {
      "minimumElasticInstanceCount": 1,
      "maximumElasticInstanceCount": 20,
      "functionAppScaleLimit": 200
    }
  }
}
```

#### Auto-scaling Configuration
```typescript
// infrastructure/bicep/modules/functionApp.bicep
resource functionApp 'Microsoft.Web/sites@2022-03-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: hostingPlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~18'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
      ]
      cors: {
        allowedOrigins: [
          'https://${staticWebAppName}.azurestaticapps.net'
        ]
      }
      use32BitWorkerProcess: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
}

resource autoScaleSettings 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: '${functionAppName}-autoscale'
  location: location
  properties: {
    enabled: true
    targetResourceUri: hostingPlan.id
    profiles: [
      {
        name: 'Default'
        capacity: {
          minimum: '1'
          maximum: '20'
          default: '2'
        }
        rules: [
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: hostingPlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT5M'
            }
          }
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: hostingPlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
            scaleAction: {
              direction: 'Decrease'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT10M'
            }
          }
        ]
      }
    ]
  }
}
```
