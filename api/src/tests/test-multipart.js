const multipart = require('parse-multipart');
const fs = require('fs');
const path = require('path');

// Create a test Excel file buffer (minimal XLSX structure)
function createTestExcelBuffer() {
    // This is a minimal valid XLSX file structure
    const xlsxHeader = Buffer.from([
        0x50, 0x4B, 0x03, 0x04, // ZIP file signature
        0x14, 0x00, 0x00, 0x00, 0x08, 0x00, // ZIP header
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);
    
    // Add some dummy content to make it look like an Excel file
    const content = Buffer.concat([
        xlsxHeader,
        Buffer.from('test excel content'),
        Buffer.from([0x50, 0x4B, 0x05, 0x06]) // ZIP end signature
    ]);
    
    return content;
}

function createMultipartFormData() {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const excelBuffer = createTestExcelBuffer();
    
    let formData = '';
    
    // Add metadata fields
    const fields = {
        'company': 'Test Company',
        'business_unit': 'IT',
        'location': 'New York',
        'time_period': '2024',
        'esg_topic': 'Environment',
        'esg_metric': 'Energy Consumption',
        'unit': 'kWh'
    };
    
    // Add each field
    for (const [key, value] of Object.entries(fields)) {
        formData += `--${boundary}\r\n`;
        formData += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
        formData += `${value}\r\n`;
    }
    
    // Add file
    formData += `--${boundary}\r\n`;
    formData += `Content-Disposition: form-data; name="file"; filename="test.xlsx"\r\n`;
    formData += `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;
    
    // Convert string parts to buffer and combine with file buffer
    const formDataStart = Buffer.from(formData, 'utf8');
    const formDataEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    
    const fullFormData = Buffer.concat([formDataStart, excelBuffer, formDataEnd]);
    
    return {
        buffer: fullFormData,
        boundary: boundary,
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

async function testMultipartParsing() {
    try {
        console.log('Testing multipart form data parsing...');
        
        // Create test form data
        const { buffer, boundary, contentType } = createMultipartFormData();
        
        console.log('Form data size:', buffer.length, 'bytes');
        console.log('Content-Type:', contentType);
        console.log('Boundary:', boundary);
        
        // Test boundary extraction
        console.log('\n--- Testing boundary extraction ---');
        const extractedBoundary = multipart.getBoundary(contentType);
        console.log('Extracted boundary:', extractedBoundary);
        
        if (!extractedBoundary) {
            throw new Error('Failed to extract boundary from content-type');
        }
        
        if (extractedBoundary !== boundary) {
            throw new Error(`Boundary mismatch: expected "${boundary}", got "${extractedBoundary}"`);
        }
        
        // Test parsing
        console.log('\n--- Testing form data parsing ---');
        const parts = multipart.Parse(buffer, extractedBoundary);
        
        console.log('Number of parts found:', parts.length);
        
        // Analyze each part
        const fields = {};
        let filePart = null;
        
        parts.forEach((part, index) => {
            console.log(`\nPart ${index + 1}:`);
            console.log('  Name:', part.name);
            console.log('  Filename:', part.filename || 'N/A');
            console.log('  Type:', part.type || 'N/A');
            console.log('  Data length:', part.data ? part.data.length : 0, 'bytes');
            
            if (part.filename) {
                filePart = part;
                console.log('  -> This is the file part');
            } else {
                fields[part.name] = part.data.toString();
                console.log('  -> Field value:', part.data.toString());
            }
        });
        
        // Validate results
        console.log('\n--- Validation ---');
        
        if (!filePart) {
            throw new Error('No file part found in parsed data');
        }
        
        console.log('✅ File part found:');
        console.log('  Filename:', filePart.filename);
        console.log('  Content-Type:', filePart.type);
        console.log('  File size:', filePart.data.length, 'bytes');
        
        // Check if it's an Excel file
        const isExcel = filePart.filename.match(/\.(xlsx|xls)$/i);
        console.log('  Is Excel file:', !!isExcel);
        
        console.log('✅ Metadata fields found:');
        Object.entries(fields).forEach(([key, value]) => {
            console.log(`  ${key}: ${value}`);
        });
        
        // Validate required fields
        const requiredFields = ['company', 'business_unit', 'location', 'time_period', 'esg_topic', 'esg_metric', 'unit'];
        const missingFields = requiredFields.filter(field => !fields[field]);
        
        if (missingFields.length > 0) {
            console.log('⚠️  Missing required fields:', missingFields);
        } else {
            console.log('✅ All required fields present');
        }
        
        console.log('\n🎉 Multipart parsing test completed successfully!');
        
        return {
            filePart,
            fields,
            success: true
        };
        
    } catch (error) {
        console.error('❌ Multipart parsing test failed:');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return {
            success: false,
            error: error.message
        };
    }
}

// Run the test
testMultipartParsing().then(result => {
    if (!result.success) {
        process.exit(1);
    }
});
