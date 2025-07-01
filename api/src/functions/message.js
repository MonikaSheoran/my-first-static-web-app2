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