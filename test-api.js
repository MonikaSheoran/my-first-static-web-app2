const fs = require('fs');
const path = require('path');

// Create a simple test Excel file
function createTestExcelFile() {
    // Create a minimal XLSX file structure
    const xlsxContent = Buffer.from([
        0x50, 0x4B, 0x03, 0x04, // ZIP signature
        0x14, 0x00, 0x00, 0x00, 0x08, 0x00, // ZIP header
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // Add some content
        ...Buffer.from('test excel content for upload'),
        // ZIP end signature
        0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);
    
    const testFilePath = path.join(__dirname, 'test-upload.xlsx');
    fs.writeFileSync(testFilePath, xlsxContent);
    return testFilePath;
}

async function testUpload() {
    try {
        console.log('Creating test Excel file...');
        const testFilePath = createTestExcelFile();
        console.log('Test file created:', testFilePath);
        
        // Test the message endpoint first
        console.log('\n--- Testing message endpoint ---');
        const messageResponse = await fetch('http://localhost:7071/api/message');
        const messageText = await messageResponse.text();
        console.log('Message endpoint response:', messageText);
        
        // Create form data for upload test
        console.log('\n--- Testing storage endpoint ---');
        const FormData = require('form-data');
        const formData = new FormData();
        
        // Add metadata fields
        formData.append('company', 'Test Company Inc');
        formData.append('business_unit', 'IT Department');
        formData.append('location', 'New York');
        formData.append('time_period', '2024');
        formData.append('esg_topic', 'Environment');
        formData.append('esg_metric', 'Energy Consumption');
        formData.append('unit', 'kWh');
        
        // Add file
        formData.append('file', fs.createReadStream(testFilePath), {
            filename: 'test-upload.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        
        console.log('Sending upload request...');
        
        const uploadResponse = await fetch('http://localhost:7071/api/storage', {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });
        
        console.log('Upload response status:', uploadResponse.status);
        console.log('Upload response headers:', Object.fromEntries(uploadResponse.headers.entries()));
        
        const responseText = await uploadResponse.text();
        console.log('Upload response body:', responseText);
        
        let responseData;
        try {
            responseData = JSON.parse(responseText);
            console.log('\n--- Parsed Response ---');
            console.log(JSON.stringify(responseData, null, 2));
            
            if (responseData.success) {
                console.log('\n✅ Upload test PASSED!');
                console.log('File uploaded to:', responseData.url);
            } else {
                console.log('\n❌ Upload test FAILED!');
                console.log('Error:', responseData.error);
                if (responseData.details) {
                    console.log('Details:', responseData.details);
                }
            }
        } catch (parseError) {
            console.log('\n❌ Failed to parse response as JSON');
            console.log('Raw response:', responseText);
        }
        
        // Clean up test file
        fs.unlinkSync(testFilePath);
        console.log('\nTest file cleaned up');
        
    } catch (error) {
        console.error('\n❌ Test failed with error:');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Import required modules
global.fetch = require('node-fetch');
testUpload();
