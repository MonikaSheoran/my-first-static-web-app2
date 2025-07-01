# Phase 1 Implementation Guide (Weeks 1-2)

## 1.1 TypeScript Migration

### Step 1: Setup TypeScript Environment
```bash
# Install TypeScript and dependencies
npm install -D typescript @types/node @azure/functions-types
npm install -D @types/parse-multipart

# Create tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 2: Convert API to TypeScript
```typescript
// api/src/types.ts
export interface UploadMetadata {
  company: string;
  business_unit: string;
  location: string;
  time_period: string;
  esg_topic: string;
  esg_metric: string;
  unit: string;
}

export interface UploadResponse {
  success: boolean;
  message?: string;
  fileName?: string;
  originalFileName?: string;
  url?: string;
  metadata?: UploadMetadata;
  uploadedAt?: string;
  error?: string;
  details?: string;
  missingFields?: string[];
}

export interface FileProcessingResult {
  fileId: string;
  originalName: string;
  processedData?: any;
  errors?: string[];
}
```

### Step 3: Enhanced File Type Support
```typescript
// api/src/fileProcessors/index.ts
import { ExcelProcessor } from './excelProcessor';
import { CsvProcessor } from './csvProcessor';
import { PdfProcessor } from './pdfProcessor';

export class FileProcessorFactory {
  static getProcessor(fileExtension: string, mimeType: string) {
    switch (fileExtension.toLowerCase()) {
      case 'xlsx':
      case 'xls':
        return new ExcelProcessor();
      case 'csv':
        return new CsvProcessor();
      case 'pdf':
        return new PdfProcessor();
      default:
        throw new Error(`Unsupported file type: ${fileExtension}`);
    }
  }
}

// api/src/fileProcessors/csvProcessor.ts
import * as csv from 'csv-parser';
import { Readable } from 'stream';

export class CsvProcessor {
  async process(fileBuffer: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const stream = Readable.from(fileBuffer);
      
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }
  
  validate(data: any[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (data.length === 0) {
      errors.push('CSV file is empty');
    }
    
    // Add more validation rules
    return { isValid: errors.length === 0, errors };
  }
}
```

## 1.2 Enhanced Error Handling & Logging

### Application Insights Integration
```typescript
// api/src/utils/logger.ts
import { TelemetryClient } from 'applicationinsights';

export class Logger {
  private static client: TelemetryClient;
  
  static initialize(instrumentationKey: string) {
    const appInsights = require('applicationinsights');
    appInsights.setup(instrumentationKey).start();
    this.client = appInsights.defaultClient;
  }
  
  static logEvent(name: string, properties?: any, metrics?: any) {
    this.client.trackEvent({ name, properties, measurements: metrics });
  }
  
  static logError(error: Error, properties?: any) {
    this.client.trackException({ exception: error, properties });
  }
  
  static logMetric(name: string, value: number, properties?: any) {
    this.client.trackMetric({ name, value, properties });
  }
}
```

### Enhanced API Error Handling
```typescript
// api/src/middleware/errorHandler.ts
import { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { Logger } from '../utils/logger';

export class ErrorHandler {
  static handleError(error: any, context: InvocationContext): HttpResponseInit {
    const errorId = this.generateErrorId();
    
    Logger.logError(error, {
      errorId,
      functionName: context.functionName,
      invocationId: context.invocationId
    });
    
    // Don't expose internal errors to client
    if (error.name === 'ValidationError') {
      return {
        status: 400,
        jsonBody: {
          success: false,
          error: 'Validation failed',
          details: error.message,
          errorId
        }
      };
    }
    
    return {
      status: 500,
      jsonBody: {
        success: false,
        error: 'Internal server error',
        errorId
      }
    };
  }
  
  private static generateErrorId(): string {
    return `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

## 1.3 Improved Frontend Architecture

### Modular JavaScript Structure
```javascript
// src/js/modules/fileUploader.js
class FileUploader {
  constructor(options) {
    this.apiEndpoint = options.apiEndpoint;
    this.allowedTypes = options.allowedTypes || ['.xlsx', '.xls', '.csv', '.pdf'];
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.onProgress = options.onProgress || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (() => {});
  }
  
  validateFile(file) {
    const errors = [];
    
    // Check file type
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    if (!this.allowedTypes.includes(extension)) {
      errors.push(`File type ${extension} is not supported. Allowed types: ${this.allowedTypes.join(', ')}`);
    }
    
    // Check file size
    if (file.size > this.maxFileSize) {
      errors.push(`File size (${this.formatFileSize(file.size)}) exceeds maximum allowed size (${this.formatFileSize(this.maxFileSize)})`);
    }
    
    return { isValid: errors.length === 0, errors };
  }
  
  async upload(file, metadata) {
    const validation = this.validateFile(file);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    // Add metadata
    Object.keys(metadata).forEach(key => {
      formData.append(key, metadata[key]);
    });
    
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.onSuccess(result);
        return result;
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
```

## 1.4 Acceptance Criteria

### Functional Requirements
- [ ] Support for Excel, CSV, and PDF file uploads
- [ ] TypeScript implementation with proper type safety
- [ ] Enhanced error handling with unique error IDs
- [ ] Application Insights integration for monitoring
- [ ] Improved file validation with detailed error messages
- [ ] Modular frontend architecture

### Non-Functional Requirements
- [ ] 99.9% uptime for file upload functionality
- [ ] Response time < 2 seconds for file validation
- [ ] Support for files up to 10MB
- [ ] Comprehensive error logging and monitoring

### Testing Requirements
- [ ] Unit tests for all file processors
- [ ] Integration tests for API endpoints
- [ ] End-to-end tests for upload workflow
- [ ] Performance tests for large file uploads
