const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require('fs');
const path = require('path');

async function testConnection() {
    try {
        console.log('Testing Azure Blob Storage connection...');

        // Load local settings
        let connectionString = process.env.AzureWebJobsStorage;

        if (!connectionString) {
            console.log('Loading connection string from local.settings.json...');
            const localSettingsPath = path.join(__dirname, 'local.settings.json');
            if (fs.existsSync(localSettingsPath)) {
                const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
                connectionString = localSettings.Values?.AzureWebJobsStorage;
            }
        }

        if (!connectionString) {
            throw new Error('AzureWebJobsStorage not found in environment or local.settings.json');
        }
        
        console.log('Connection string found:', connectionString.substring(0, 50) + '...');
        
        // Create BlobServiceClient
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        
        // Test connection by listing containers
        console.log('Attempting to list containers...');
        const containers = [];
        for await (const container of blobServiceClient.listContainers()) {
            containers.push(container.name);
        }
        
        console.log('✅ Connection successful!');
        console.log('Available containers:', containers);
        
        // Test creating/accessing the upload container
        const containerName = 'upload';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        console.log(`Testing container "${containerName}"...`);
        
        // Check if container exists
        const exists = await containerClient.exists();
        console.log(`Container "${containerName}" exists:`, exists);
        
        if (!exists) {
            console.log('Creating container...');
            await containerClient.createIfNotExists({
                access: 'blob' // Allow public read access to blobs
            });
            console.log('✅ Container created successfully!');
        }
        
        // Test blob operations
        console.log('Testing blob operations...');
        const testBlobName = 'test-connection.txt';
        const blockBlobClient = containerClient.getBlockBlobClient(testBlobName);
        
        // Upload test data
        const testData = 'Connection test successful at ' + new Date().toISOString();
        await blockBlobClient.upload(testData, testData.length, {
            blobHTTPHeaders: { blobContentType: 'text/plain' }
        });
        
        console.log('✅ Test blob uploaded successfully!');
        console.log('Blob URL:', blockBlobClient.url);
        
        // Clean up test blob
        await blockBlobClient.delete();
        console.log('✅ Test blob cleaned up');
        
        console.log('\n🎉 All tests passed! Azure Blob Storage is working correctly.');
        
    } catch (error) {
        console.error('❌ Connection test failed:');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        if (error.code) {
            console.error('Error Code:', error.code);
        }
        if (error.statusCode) {
            console.error('Status Code:', error.statusCode);
        }
        
        process.exit(1);
    }
}

// Run the test
testConnection();
