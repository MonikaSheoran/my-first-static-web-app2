const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { IncomingForm } = require('formidable');
const fs = require('fs');

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
    authLevel: 'function',
    handler: async (request, context) => {
        // Parse form data as a Promise
        const form = new IncomingForm({ multiples: false });
        const { fields, files, error } = await new Promise((resolve) => {
            form.parse(request, (err, fields, files) => {
                if (err) resolve({ error: err });
                else resolve({ fields, files });
            });
        });
        if (error) {
            return { status: 400, body: { error: 'Error parsing form data', details: error.message } };
        }
        if (!files || !files.file) {
            return { status: 400, body: { error: 'No file uploaded' } };
        }
        const file = files.file;
        const filePath = file.filepath || file.path;
        const fileName = file.originalFilename || file.name;
        try {
            const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
            const containerName = 'upload';
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists();
            const blockBlobClient = containerClient.getBlockBlobClient(fileName);
            const uploadStream = fs.createReadStream(filePath);
            await blockBlobClient.uploadStream(uploadStream, undefined, undefined, {
                blobHTTPHeaders: { blobContentType: file.mimetype || 'application/octet-stream' }
            });
            return {
                status: 200,
                body: {
                    message: 'File uploaded successfully',
                    fileName,
                    url: blockBlobClient.url
                }
            };
        } catch (uploadErr) {
            return { status: 500, body: { error: 'Failed to upload file', details: uploadErr.message } };
        }
    }
});
