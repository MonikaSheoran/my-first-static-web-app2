const multipart = require('parse-multipart');
const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    // Get boundary from content-type header
    const contentType = req.headers['content-type'] || req.headers['Content-Type'];
    
+   context.log("Index.js entry point", { context, req });
    if (!contentType) {
        context.res = { status: 400, body: 'Missing content-type header' };

        return;
    }
    const boundary = multipart.getBoundary(contentType);

    // Get raw body as Buffer
    const bodyBuffer = Buffer.from(await req.arrayBuffer());

    // Parse the multipart form data
    const parts = multipart.Parse(bodyBuffer, boundary);

    // Find the file part (assume first file)
    const filePart = parts.find(p => p.filename);
    if (!filePart) {
        context.res = { status: 400, body: 'No file uploaded' };
        return;
    }

    // Get metadata fields
    const fields = {};
    for (const part of parts) {
        if (!part.filename) {
            fields[part.name] = part.data.toString();
        }
    }

    // Upload to Azure Blob Storage
    const AZURE_STORAGE_CONNECTION_STRING = process.env.AzureWebJobsStorage;
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
    const containerName = 'uploads';
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(filePart.filename);
    await blockBlobClient.uploadData(filePart.data);

    context.res = {
        status: 200,
        body: {
            message: 'File uploaded successfully',
            fileName: filePart.filename,
            metadata: fields
        }
    };
};
