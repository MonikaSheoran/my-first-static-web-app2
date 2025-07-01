const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const multipart = require('parse-multipart');

// Storage function (v4 model)
app.http('storage', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log('Storage upload request received');

            // Get boundary from content-type header
            const contentType = request.headers.get('content-type') || request.headers.get('Content-Type');
            if (!contentType) {
                context.log('Error: Missing content-type header');
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Missing content-type header'
                    }
                };
            }

            const boundary = multipart.getBoundary(contentType);
            if (!boundary) {
                context.log('Error: Boundary not found in content-type:', contentType);
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Malformed content-type header: boundary not found'
                    }
                };
            }

            context.log('Boundary extracted:', boundary);

            // Get raw body as Buffer
            const bodyBuffer = Buffer.from(await request.arrayBuffer());
            context.log('Body buffer size:', bodyBuffer.length, 'bytes');

            // Parse the multipart form data
            let parts;
            try {
                parts = multipart.Parse(bodyBuffer, boundary);
                context.log('Parsed parts count:', parts.length);
            } catch (parseError) {
                context.log('Error parsing multipart data:', parseError.message);
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Failed to parse multipart data',
                        details: parseError.message
                    }
                };
            }

            // Find the file part
            const filePart = parts.find(p => p.filename);
            if (!filePart) {
                context.log('Error: No file part found in upload');
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'No file uploaded'
                    }
                };
            }

            context.log('File found:', filePart.filename, 'Size:', filePart.data?.length || 0, 'bytes');

            // Validate Excel file type
            const isExcelFile = /\.(xlsx|xls)$/i.test(filePart.filename);
            if (!isExcelFile) {
                context.log('Error: Invalid file type:', filePart.filename);
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Invalid file type. Only .xlsx and .xls files are allowed.'
                    }
                };
            }

            // Get metadata fields
            const fields = {};
            for (const part of parts) {
                if (!part.filename && part.name) {
                    fields[part.name] = part.data.toString();
                }
            }

            context.log('Metadata fields:', Object.keys(fields));

            // Validate required fields
            const requiredFields = ['company', 'business_unit', 'location', 'time_period', 'esg_topic', 'esg_metric', 'unit'];
            const missingFields = requiredFields.filter(field => !fields[field] || fields[field].trim() === '');

            if (missingFields.length > 0) {
                context.log('Error: Missing required fields:', missingFields);
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Missing required fields',
                        missingFields: missingFields
                    }
                };
            }

            // Load connection string from local settings if not in environment
            let connectionString = process.env.AzureWebJobsStorage;
            if (!connectionString) {
                const fs = require('fs');
                const path = require('path');
                const localSettingsPath = path.join(__dirname, 'local.settings.json');
                if (fs.existsSync(localSettingsPath)) {
                    const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
                    connectionString = localSettings.Values?.AzureWebJobsStorage;
                }
            }

            if (!connectionString) {
                context.log('Error: Azure Storage connection string not found');
                return {
                    status: 500,
                    jsonBody: {
                        success: false,
                        error: 'Azure Storage configuration not found'
                    }
                };
            }

            // Upload to Azure Blob Storage
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerName = 'upload';
            const containerClient = blobServiceClient.getContainerClient(containerName);

            // Ensure container exists
            await containerClient.createIfNotExists({
                access: 'blob'
            });

            // Create unique filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileExtension = filePart.filename.split('.').pop();
            const uniqueFilename = `${fields.company}_${timestamp}.${fileExtension}`;

            const blockBlobClient = containerClient.getBlockBlobClient(uniqueFilename);

            // Set appropriate content type for Excel files
            const contentTypeMap = {
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'xls': 'application/vnd.ms-excel'
            };
            const fileContentType = contentTypeMap[fileExtension.toLowerCase()] || 'application/octet-stream';

            await blockBlobClient.uploadData(filePart.data, {
                blobHTTPHeaders: {
                    blobContentType: fileContentType
                },
                metadata: {
                    originalFilename: filePart.filename,
                    uploadedAt: new Date().toISOString(),
                    ...fields
                }
            });

            context.log('File uploaded successfully:', uniqueFilename);

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    message: 'File uploaded successfully',
                    fileName: uniqueFilename,
                    originalFileName: filePart.filename,
                    url: blockBlobClient.url,
                    metadata: fields,
                    uploadedAt: new Date().toISOString()
                }
            };

        } catch (error) {
            context.log('Unexpected error:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    error: 'Internal server error',
                    details: error.message
                }
            };
        }
    }
});
