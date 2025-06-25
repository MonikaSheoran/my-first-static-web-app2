const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const multipart = require('parse-multipart');

// Message function (v4 model)
app.http('message', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        return { body: `Hello, from the API!` };
    }
});

// Storage function (v4 model)
app.http('storage', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // Get boundary from content-type header
        const contentType = request.headers.get('content-type') || request.headers.get('Content-Type');
        if (!contentType) {
            return { status: 400, body: 'Missing content-type header' };
        }
        const boundary = multipart.getBoundary(contentType);
        if (!boundary) {
            return { status: 400, body: 'Malformed content-type header: boundary not found' };
        }
        // Get raw body as Buffer
        const bodyBuffer = Buffer.from(await request.arrayBuffer());
        // Parse the multipart form data
        const parts = multipart.Parse(bodyBuffer, boundary);
        // Find the file part (assume first file)
        const filePart = parts.find(p => p.filename);
        if (!filePart) {
            return { status: 400, body: 'No file uploaded' };
        }
        // Get metadata fields
        const fields = {};
        for (const part of parts) {
            if (!part.filename) {
                fields[part.name] = part.data.toString();
            }
        }
        try {
            const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
            const containerName = 'upload';
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists();
            const blockBlobClient = containerClient.getBlockBlobClient(filePart.filename);
            await blockBlobClient.uploadData(filePart.data, {
                blobHTTPHeaders: { blobContentType: filePart.type || 'application/octet-stream' }
            });
            return {
                status: 200,
                body: {
                    message: 'File uploaded successfully',
                    fileName: filePart.filename,
                    url: blockBlobClient.url,
                    metadata: fields
                }
            };
        } catch (uploadErr) {
            return { status: 500, body: { error: 'Failed to upload file', details: uploadErr.message } };
        }
    }
});
