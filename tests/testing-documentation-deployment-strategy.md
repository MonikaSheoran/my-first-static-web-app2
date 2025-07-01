# Testing, Documentation & Deployment Strategy

## 6. Testing and Quality Assurance Strategy

### 6.1 Testing Framework Setup

#### Unit Testing Configuration
```json
// api/jest.config.js
{
  "preset": "ts-jest",
  "testEnvironment": "node",
  "roots": ["<rootDir>/src", "<rootDir>/tests"],
  "testMatch": ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  "transform": {
    "^.+\\.ts$": "ts-jest"
  },
  "collectCoverageFrom": [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/types/**/*"
  ],
  "coverageThreshold": {
    "global": {
      "branches": 80,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  },
  "setupFilesAfterEnv": ["<rootDir>/tests/setup.ts"]
}
```

#### API Unit Tests Example
```typescript
// api/tests/unit/services/fileUploadService.test.ts
import { FileUploadService } from '../../../src/services/fileUploadService';
import { BlobStorageService } from '../../../src/services/blobStorageService';
import { CosmosDbService } from '../../../src/services/cosmosDbService';

jest.mock('../../../src/services/blobStorageService');
jest.mock('../../../src/services/cosmosDbService');

describe('FileUploadService', () => {
  let fileUploadService: FileUploadService;
  let mockBlobService: jest.Mocked<BlobStorageService>;
  let mockCosmosService: jest.Mocked<CosmosDbService>;

  beforeEach(() => {
    mockBlobService = new BlobStorageService('') as jest.Mocked<BlobStorageService>;
    mockCosmosService = new CosmosDbService('', '') as jest.Mocked<CosmosDbService>;
    fileUploadService = new FileUploadService(mockBlobService, mockCosmosService);
  });

  describe('uploadFile', () => {
    it('should successfully upload Excel file', async () => {
      // Arrange
      const mockFile = {
        filename: 'test.xlsx',
        data: Buffer.from('test data'),
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
      const mockMetadata = {
        company: 'Test Corp',
        business_unit: 'IT',
        location: 'NYC',
        time_period: '2024',
        esg_topic: 'Environment',
        esg_metric: 'Energy',
        unit: 'kWh'
      };

      mockBlobService.uploadFile.mockResolvedValue({
        url: 'https://storage.blob.core.windows.net/upload/test.xlsx',
        fileName: 'test_123.xlsx'
      });

      mockCosmosService.createFileRecord.mockResolvedValue({
        id: 'file-123',
        ...mockMetadata
      });

      // Act
      const result = await fileUploadService.uploadFile(mockFile, mockMetadata, 'user-123');

      // Assert
      expect(result.success).toBe(true);
      expect(result.fileName).toBe('test_123.xlsx');
      expect(mockBlobService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'test.xlsx',
          data: mockFile.data
        })
      );
      expect(mockCosmosService.createFileRecord).toHaveBeenCalled();
    });

    it('should reject non-Excel files', async () => {
      // Arrange
      const mockFile = {
        filename: 'test.txt',
        data: Buffer.from('test data'),
        type: 'text/plain'
      };

      // Act & Assert
      await expect(
        fileUploadService.uploadFile(mockFile, {} as any, 'user-123')
      ).rejects.toThrow('Invalid file type');
    });
  });
});
```

#### Frontend Unit Tests
```typescript
// frontend/tests/unit/services/apiService.test.ts
import { ApiService } from '../../../src/services/apiService';

// Mock fetch globally
global.fetch = jest.fn();

describe('ApiService', () => {
  let apiService: ApiService;
  const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    apiService = new ApiService('https://api.test.com');
    mockFetch.mockClear();
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const mockMetadata = {
        company: 'Test Corp',
        business_unit: 'IT',
        location: 'NYC',
        time_period: '2024',
        esg_topic: 'Environment' as const,
        esg_metric: 'Energy',
        unit: 'kWh'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { fileName: 'test_123.xlsx', url: 'https://...' }
        })
      } as Response);

      // Act
      const result = await apiService.uploadFile(mockFile, mockMetadata);

      // Assert
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/storage',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData)
        })
      );
    });
  });
});
```

### 6.2 Integration Testing

#### Azure Services Integration Tests
```typescript
// api/tests/integration/azureServices.test.ts
import { CosmosDbService } from '../../src/services/cosmosDbService';
import { BlobStorageService } from '../../src/services/blobStorageService';

describe('Azure Services Integration', () => {
  let cosmosService: CosmosDbService;
  let blobService: BlobStorageService;

  beforeAll(async () => {
    // Use test environment connection strings
    cosmosService = new CosmosDbService(
      process.env.TEST_COSMOS_CONNECTION_STRING!,
      'TestDatabase'
    );
    blobService = new BlobStorageService(
      process.env.TEST_STORAGE_CONNECTION_STRING!
    );
  });

  describe('File Upload Flow', () => {
    it('should complete end-to-end file upload', async () => {
      // Arrange
      const testFile = {
        filename: 'integration-test.xlsx',
        data: Buffer.from('test excel data'),
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };

      // Act - Upload to blob storage
      const blobResult = await blobService.uploadFile(testFile);
      expect(blobResult.url).toBeDefined();

      // Act - Create file record in Cosmos DB
      const fileRecord = {
        id: 'test-file-123',
        partitionKey: 'test-org',
        originalFileName: testFile.filename,
        storedFileName: blobResult.fileName,
        fileSize: testFile.data.length,
        fileType: 'xlsx',
        mimeType: testFile.type,
        blobUrl: blobResult.url,
        uploadedBy: 'test-user',
        uploadedAt: new Date(),
        metadata: {
          company: 'Test Corp',
          business_unit: 'IT',
          location: 'NYC',
          time_period: '2024',
          esg_topic: 'Environment',
          esg_metric: 'Energy',
          unit: 'kWh'
        },
        processingStatus: 'pending' as const,
        tags: [],
        isDeleted: false
      };

      const cosmosResult = await cosmosService.createFileRecord(fileRecord);
      expect(cosmosResult.id).toBe('test-file-123');

      // Cleanup
      await cosmosService.deleteFileRecord('test-file-123', 'test-org');
      await blobService.deleteFile(blobResult.fileName);
    });
  });
});
```

### 6.3 End-to-End Testing

#### Playwright E2E Tests
```typescript
// frontend/tests/e2e/fileUpload.spec.ts
import { test, expect } from '@playwright/test';

test.describe('File Upload Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should upload Excel file successfully', async ({ page }) => {
    // Navigate to upload page
    await page.click('[data-testid="upload-button"]');
    
    // Fill in metadata form
    await page.fill('[data-testid="company-input"]', 'Test Company');
    await page.fill('[data-testid="business-unit-input"]', 'IT');
    await page.fill('[data-testid="location-input"]', 'New York');
    await page.fill('[data-testid="time-period-input"]', '2024');
    await page.selectOption('[data-testid="esg-topic-select"]', 'Environment');
    await page.fill('[data-testid="esg-metric-input"]', 'Energy Consumption');
    await page.fill('[data-testid="unit-input"]', 'kWh');

    // Upload file
    const fileInput = page.locator('[data-testid="file-input"]');
    await fileInput.setInputFiles('tests/fixtures/sample.xlsx');

    // Submit form
    await page.click('[data-testid="submit-button"]');

    // Wait for success message
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="success-message"]')).toContainText('File uploaded successfully');

    // Verify file appears in dashboard
    await page.click('[data-testid="dashboard-link"]');
    await expect(page.locator('[data-testid="file-list"]')).toContainText('sample.xlsx');
  });

  test('should show error for invalid file type', async ({ page }) => {
    await page.click('[data-testid="upload-button"]');
    
    const fileInput = page.locator('[data-testid="file-input"]');
    await fileInput.setInputFiles('tests/fixtures/invalid.txt');

    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid file type');
  });
});
```

### 6.4 Performance Testing

#### Load Testing with Artillery
```yaml
# tests/performance/load-test.yml
config:
  target: 'https://esg-app.azurestaticapps.net'
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm up"
    - duration: 300
      arrivalRate: 10
      name: "Sustained load"
    - duration: 120
      arrivalRate: 20
      name: "Peak load"
  processor: "./test-functions.js"

scenarios:
  - name: "File Upload Flow"
    weight: 70
    flow:
      - post:
          url: "/api/storage"
          formData:
            company: "Test Company"
            business_unit: "IT"
            location: "NYC"
            time_period: "2024"
            esg_topic: "Environment"
            esg_metric: "Energy"
            unit: "kWh"
            file: "@./fixtures/sample.xlsx"
          capture:
            - json: "$.fileName"
              as: "uploadedFileName"
      - think: 2
      
  - name: "Dashboard Access"
    weight: 30
    flow:
      - get:
          url: "/api/files"
          headers:
            Authorization: "Bearer {{ authToken }}"
      - think: 1
      - get:
          url: "/api/analytics"
          headers:
            Authorization: "Bearer {{ authToken }}"
```

## 7. Documentation and Knowledge Transfer Plan

### 7.1 API Documentation

#### OpenAPI Specification
```yaml
# docs/api/openapi.yml
openapi: 3.0.3
info:
  title: ESG Data Platform API
  description: API for uploading and managing ESG data files
  version: 1.0.0
  contact:
    name: Development Team
    email: dev@company.com

servers:
  - url: https://esg-functions.azurewebsites.net/api
    description: Production server
  - url: https://esg-functions-dev.azurewebsites.net/api
    description: Development server

paths:
  /storage:
    post:
      summary: Upload file with metadata
      description: Upload an Excel file with ESG metadata
      operationId: uploadFile
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
                  description: Excel file (.xlsx or .xls)
                company:
                  type: string
                  example: "Acme Corporation"
                business_unit:
                  type: string
                  example: "IT Department"
                location:
                  type: string
                  example: "New York"
                time_period:
                  type: string
                  example: "2024"
                esg_topic:
                  type: string
                  enum: [Environment, Social, Governance]
                esg_metric:
                  type: string
                  example: "Energy Consumption"
                unit:
                  type: string
                  example: "kWh"
              required:
                - file
                - company
                - business_unit
                - location
                - time_period
                - esg_topic
                - esg_metric
                - unit
      responses:
        '200':
          description: File uploaded successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UploadResponse'
        '400':
          description: Bad request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  /files:
    get:
      summary: List uploaded files
      description: Get paginated list of uploaded files
      parameters:
        - name: skip
          in: query
          schema:
            type: integer
            default: 0
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
        - name: filter
          in: query
          schema:
            type: string
        - name: sortBy
          in: query
          schema:
            type: string
            default: uploadedAt
        - name: sortOrder
          in: query
          schema:
            type: string
            enum: [asc, desc]
            default: desc
      responses:
        '200':
          description: List of files
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/FileListResponse'

components:
  schemas:
    UploadResponse:
      type: object
      properties:
        success:
          type: boolean
        message:
          type: string
        fileName:
          type: string
        originalFileName:
          type: string
        url:
          type: string
        uploadedAt:
          type: string
          format: date-time
        metadata:
          $ref: '#/components/schemas/FileMetadata'

    FileMetadata:
      type: object
      properties:
        company:
          type: string
        business_unit:
          type: string
        location:
          type: string
        time_period:
          type: string
        esg_topic:
          type: string
        esg_metric:
          type: string
        unit:
          type: string

    ErrorResponse:
      type: object
      properties:
        success:
          type: boolean
          example: false
        error:
          type: string
        details:
          type: string
        missingFields:
          type: array
          items:
            type: string

  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

security:
  - BearerAuth: []
```

### 7.2 User Documentation

#### User Guide Structure
```markdown
# ESG Data Platform User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Uploading Files](#uploading-files)
3. [Managing Files](#managing-files)
4. [Analytics Dashboard](#analytics-dashboard)
5. [Troubleshooting](#troubleshooting)

## Getting Started

### System Requirements
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Internet connection
- Valid organizational account

### Accessing the Platform
1. Navigate to https://esg.company.com
2. Click "Sign In" and authenticate with your organizational account
3. Complete the initial setup wizard if this is your first login

## Uploading Files

### Supported File Types
- Excel files (.xlsx, .xls)
- CSV files (.csv)
- PDF documents (.pdf)

### Upload Process
1. Click the "Upload" button on the main dashboard
2. Drag and drop your file or click "Browse" to select
3. Fill in the required metadata fields:
   - **Company**: Your organization name
   - **Business Unit**: Department or division
   - **Location**: Geographic location
   - **Time Period**: Reporting period (e.g., "2024", "Q1 2024")
   - **ESG Topic**: Environment, Social, or Governance
   - **ESG Metric**: Specific metric being reported
   - **Unit**: Unit of measurement
4. Click "Upload & Process"
5. Wait for confirmation message

### Metadata Guidelines
- Use consistent naming conventions across uploads
- Include specific time periods for trend analysis
- Ensure units are standardized (e.g., always use "kWh" for energy)
```

## 8. Deployment and DevOps Strategy

### 8.1 CI/CD Pipeline

#### GitHub Actions Workflow
```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  AZURE_FUNCTIONAPP_NAME: esg-functions-app
  AZURE_FUNCTIONAPP_PACKAGE_PATH: './api'
  NODE_VERSION: '18.x'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: |
            api/package-lock.json
            frontend/package-lock.json
      
      - name: Install API dependencies
        run: npm ci
        working-directory: ./api
      
      - name: Install Frontend dependencies
        run: npm ci
        working-directory: ./frontend
      
      - name: Run API tests
        run: npm run test:coverage
        working-directory: ./api
        env:
          TEST_COSMOS_CONNECTION_STRING: ${{ secrets.TEST_COSMOS_CONNECTION_STRING }}
          TEST_STORAGE_CONNECTION_STRING: ${{ secrets.TEST_STORAGE_CONNECTION_STRING }}
      
      - name: Run Frontend tests
        run: npm run test:coverage
        working-directory: ./frontend
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          files: ./api/coverage/lcov.info,./frontend/coverage/lcov.info

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run security audit
        run: |
          npm audit --audit-level=high
          npm audit --audit-level=high
        working-directory: ./api
      
      - name: Run CodeQL Analysis
        uses: github/codeql-action/analyze@v2
        with:
          languages: javascript

  deploy-staging:
    needs: [test, security-scan]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment: staging
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
      
      - name: Build API
        run: |
          npm ci
          npm run build
        working-directory: ./api
      
      - name: Deploy to Azure Functions (Staging)
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}-staging
          package: ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE_STAGING }}
      
      - name: Deploy Static Web App (Staging)
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/frontend"
          api_location: "/api"
          output_location: "/dist"

  deploy-production:
    needs: [test, security-scan]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
      
      - name: Build and Deploy
        run: |
          npm ci
          npm run build
        working-directory: ./api
      
      - name: Deploy to Azure Functions (Production)
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          package: ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
      
      - name: Deploy Static Web App (Production)
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/frontend"
          api_location: "/api"
          output_location: "/dist"
      
      - name: Run smoke tests
        run: npm run test:e2e:production
        working-directory: ./frontend
```

This comprehensive roadmap provides a detailed, actionable plan for transforming your Excel file upload application into a robust, enterprise-grade ESG data management platform. Each phase builds upon the previous one, ensuring a systematic approach to development while maintaining the working functionality you currently have.
