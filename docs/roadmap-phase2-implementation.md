# Phase 2 Implementation Guide (Weeks 3-6)

## 2.1 Azure Cosmos DB Integration

### Database Schema Design
```typescript
// api/src/models/fileRecord.ts
export interface FileRecord {
  id: string;
  partitionKey: string; // organizationId
  originalFileName: string;
  storedFileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
  blobUrl: string;
  uploadedBy: string;
  uploadedAt: Date;
  metadata: UploadMetadata;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processedData?: any;
  tags: string[];
  isDeleted: boolean;
  deletedAt?: Date;
}

export interface Organization {
  id: string;
  name: string;
  domain: string;
  settings: {
    maxFileSize: number;
    allowedFileTypes: string[];
    retentionPeriod: number;
  };
  createdAt: Date;
  isActive: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: 'admin' | 'manager' | 'user';
  permissions: string[];
  lastLoginAt?: Date;
  createdAt: Date;
  isActive: boolean;
}
```

### Cosmos DB Service Implementation
```typescript
// api/src/services/cosmosDbService.ts
import { CosmosClient, Database, Container } from '@azure/cosmos';
import { FileRecord, Organization, User } from '../models';

export class CosmosDbService {
  private client: CosmosClient;
  private database: Database;
  private containers: {
    files: Container;
    organizations: Container;
    users: Container;
  };

  constructor(connectionString: string, databaseName: string) {
    this.client = new CosmosClient(connectionString);
    this.database = this.client.database(databaseName);
    
    this.containers = {
      files: this.database.container('files'),
      organizations: this.database.container('organizations'),
      users: this.database.container('users')
    };
  }

  // File operations
  async createFileRecord(fileRecord: FileRecord): Promise<FileRecord> {
    const { resource } = await this.containers.files.items.create(fileRecord);
    return resource as FileRecord;
  }

  async getFileRecord(id: string, organizationId: string): Promise<FileRecord | null> {
    try {
      const { resource } = await this.containers.files.item(id, organizationId).read();
      return resource as FileRecord;
    } catch (error) {
      if (error.code === 404) return null;
      throw error;
    }
  }

  async listFiles(organizationId: string, options: {
    skip?: number;
    limit?: number;
    filter?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ files: FileRecord[]; totalCount: number }> {
    const { skip = 0, limit = 50, filter, sortBy = 'uploadedAt', sortOrder = 'desc' } = options;
    
    let query = `SELECT * FROM c WHERE c.partitionKey = @organizationId AND c.isDeleted = false`;
    const parameters = [{ name: '@organizationId', value: organizationId }];
    
    if (filter) {
      query += ` AND (CONTAINS(LOWER(c.originalFileName), LOWER(@filter)) OR CONTAINS(LOWER(c.metadata.company), LOWER(@filter)))`;
      parameters.push({ name: '@filter', value: filter });
    }
    
    query += ` ORDER BY c.${sortBy} ${sortOrder.toUpperCase()}`;
    query += ` OFFSET ${skip} LIMIT ${limit}`;
    
    const { resources } = await this.containers.files.items.query({
      query,
      parameters
    }).fetchAll();
    
    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT VALUE COUNT(1)').split('ORDER BY')[0];
    const { resources: countResult } = await this.containers.files.items.query({
      query: countQuery,
      parameters: parameters.filter(p => p.name !== '@skip' && p.name !== '@limit')
    }).fetchAll();
    
    return {
      files: resources as FileRecord[],
      totalCount: countResult[0] || 0
    };
  }

  async updateFileRecord(id: string, organizationId: string, updates: Partial<FileRecord>): Promise<FileRecord> {
    const { resource } = await this.containers.files.item(id, organizationId).patch([
      ...Object.entries(updates).map(([key, value]) => ({
        op: 'replace',
        path: `/${key}`,
        value
      }))
    ]);
    return resource as FileRecord;
  }

  async deleteFileRecord(id: string, organizationId: string): Promise<void> {
    await this.containers.files.item(id, organizationId).patch([
      { op: 'replace', path: '/isDeleted', value: true },
      { op: 'replace', path: '/deletedAt', value: new Date() }
    ]);
  }

  // Organization operations
  async createOrganization(organization: Organization): Promise<Organization> {
    const { resource } = await this.containers.organizations.items.create(organization);
    return resource as Organization;
  }

  async getOrganization(id: string): Promise<Organization | null> {
    try {
      const { resource } = await this.containers.organizations.item(id, id).read();
      return resource as Organization;
    } catch (error) {
      if (error.code === 404) return null;
      throw error;
    }
  }

  // User operations
  async createUser(user: User): Promise<User> {
    const { resource } = await this.containers.users.items.create(user);
    return resource as User;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { resources } = await this.containers.users.items.query({
      query: 'SELECT * FROM c WHERE c.email = @email AND c.isActive = true',
      parameters: [{ name: '@email', value: email }]
    }).fetchAll();
    
    return resources.length > 0 ? resources[0] as User : null;
  }
}
```

## 2.2 Azure AD B2C Authentication

### B2C Configuration
```typescript
// api/src/auth/azureAdB2C.ts
import { Client } from '@azure/msal-node';

export class AzureAdB2CService {
  private msalClient: Client;
  
  constructor(config: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    signUpSignInPolicy: string;
  }) {
    this.msalClient = new Client({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://${config.tenantId}.b2clogin.com/${config.tenantId}.onmicrosoft.com/${config.signUpSignInPolicy}`
      }
    });
  }
  
  async validateToken(token: string): Promise<any> {
    try {
      // Validate JWT token
      const decoded = await this.msalClient.validateToken(token);
      return decoded;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
  
  async getUserInfo(token: string): Promise<{
    id: string;
    email: string;
    name: string;
    organizationId?: string;
  }> {
    const decoded = await this.validateToken(token);
    
    return {
      id: decoded.sub,
      email: decoded.email || decoded.preferred_username,
      name: decoded.name || decoded.given_name + ' ' + decoded.family_name,
      organizationId: decoded.extension_OrganizationId
    };
  }
}
```

### Authentication Middleware
```typescript
// api/src/middleware/auth.ts
import { HttpRequest, InvocationContext } from '@azure/functions';
import { AzureAdB2CService } from '../auth/azureAdB2C';
import { CosmosDbService } from '../services/cosmosDbService';

export class AuthMiddleware {
  constructor(
    private adB2CService: AzureAdB2CService,
    private cosmosService: CosmosDbService
  ) {}
  
  async authenticate(request: HttpRequest, context: InvocationContext): Promise<{
    user: any;
    organization: any;
  }> {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header');
    }
    
    const token = authHeader.substring(7);
    const userInfo = await this.adB2CService.getUserInfo(token);
    
    // Get user from database
    const user = await this.cosmosService.getUserByEmail(userInfo.email);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Get organization
    const organization = await this.cosmosService.getOrganization(user.organizationId);
    if (!organization) {
      throw new Error('Organization not found');
    }
    
    return { user, organization };
  }
}
```

## 2.3 File Management API Endpoints

### Enhanced Storage Function
```typescript
// api/src/functions/fileManagement.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { AuthMiddleware } from '../middleware/auth';
import { CosmosDbService } from '../services/cosmosDbService';
import { BlobStorageService } from '../services/blobStorageService';

// List files endpoint
app.http('listFiles', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'files',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { user, organization } = await authMiddleware.authenticate(request, context);
      
      const url = new URL(request.url);
      const skip = parseInt(url.searchParams.get('skip') || '0');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const filter = url.searchParams.get('filter') || '';
      const sortBy = url.searchParams.get('sortBy') || 'uploadedAt';
      const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' || 'desc';
      
      const result = await cosmosService.listFiles(organization.id, {
        skip,
        limit,
        filter,
        sortBy,
        sortOrder
      });
      
      return {
        status: 200,
        jsonBody: {
          success: true,
          data: result.files,
          pagination: {
            skip,
            limit,
            totalCount: result.totalCount,
            hasMore: skip + limit < result.totalCount
          }
        }
      };
    } catch (error) {
      return ErrorHandler.handleError(error, context);
    }
  }
});

// Get file details endpoint
app.http('getFile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'files/{fileId}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { user, organization } = await authMiddleware.authenticate(request, context);
      const fileId = request.params.fileId;
      
      const fileRecord = await cosmosService.getFileRecord(fileId, organization.id);
      if (!fileRecord) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            error: 'File not found'
          }
        };
      }
      
      return {
        status: 200,
        jsonBody: {
          success: true,
          data: fileRecord
        }
      };
    } catch (error) {
      return ErrorHandler.handleError(error, context);
    }
  }
});

// Delete file endpoint
app.http('deleteFile', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'files/{fileId}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { user, organization } = await authMiddleware.authenticate(request, context);
      const fileId = request.params.fileId;
      
      // Check permissions
      if (user.role !== 'admin' && user.role !== 'manager') {
        return {
          status: 403,
          jsonBody: {
            success: false,
            error: 'Insufficient permissions'
          }
        };
      }
      
      const fileRecord = await cosmosService.getFileRecord(fileId, organization.id);
      if (!fileRecord) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            error: 'File not found'
          }
        };
      }
      
      // Soft delete in database
      await cosmosService.deleteFileRecord(fileId, organization.id);
      
      // Optionally delete from blob storage
      // await blobStorageService.deleteBlob(fileRecord.storedFileName);
      
      return {
        status: 200,
        jsonBody: {
          success: true,
          message: 'File deleted successfully'
        }
      };
    } catch (error) {
      return ErrorHandler.handleError(error, context);
    }
  }
});
```

## 2.4 Basic Dashboard Implementation

### Frontend Dashboard Structure
```html
<!-- src/dashboard.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Management Dashboard</title>
    <link rel="stylesheet" href="styles/dashboard.css">
</head>
<body>
    <div class="dashboard-container">
        <header class="dashboard-header">
            <h1>File Management Dashboard</h1>
            <div class="user-info">
                <span id="userName"></span>
                <button id="logoutBtn">Logout</button>
            </div>
        </header>
        
        <nav class="dashboard-nav">
            <ul>
                <li><a href="#files" class="nav-link active">Files</a></li>
                <li><a href="#upload" class="nav-link">Upload</a></li>
                <li><a href="#analytics" class="nav-link">Analytics</a></li>
                <li><a href="#settings" class="nav-link">Settings</a></li>
            </ul>
        </nav>
        
        <main class="dashboard-main">
            <section id="files-section" class="dashboard-section active">
                <div class="section-header">
                    <h2>Files</h2>
                    <div class="section-controls">
                        <input type="text" id="searchInput" placeholder="Search files...">
                        <select id="sortSelect">
                            <option value="uploadedAt-desc">Newest First</option>
                            <option value="uploadedAt-asc">Oldest First</option>
                            <option value="originalFileName-asc">Name A-Z</option>
                            <option value="originalFileName-desc">Name Z-A</option>
                            <option value="fileSize-desc">Largest First</option>
                            <option value="fileSize-asc">Smallest First</option>
                        </select>
                    </div>
                </div>
                
                <div class="files-grid" id="filesGrid">
                    <!-- Files will be loaded here -->
                </div>
                
                <div class="pagination" id="pagination">
                    <!-- Pagination controls -->
                </div>
            </section>
        </main>
    </div>
    
    <script src="js/dashboard.js"></script>
</body>
</html>
```

## 2.5 Acceptance Criteria

### Functional Requirements
- [ ] Azure Cosmos DB integration with proper data models
- [ ] Azure AD B2C authentication working
- [ ] File listing API with pagination and filtering
- [ ] File details and deletion endpoints
- [ ] Basic dashboard with file management capabilities
- [ ] User role-based access control

### Non-Functional Requirements
- [ ] Database queries respond within 500ms
- [ ] Authentication token validation < 200ms
- [ ] Dashboard loads within 2 seconds
- [ ] Support for 1000+ files per organization

### Security Requirements
- [ ] All API endpoints require authentication
- [ ] Role-based access control implemented
- [ ] Sensitive data encrypted at rest
- [ ] Audit logging for all operations
