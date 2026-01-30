/**
 * Example: Test Bloom API Connection with Supabase
 *
 * This script demonstrates how to authenticate with the Bloom API using Supabase
 * and fetch the list of valid scanners from the cyl_scanners table.
 *
 * Setup:
 * 1. Copy this file to scripts/test-bloom-api.js (git-ignored)
 * 2. Fill in your credentials from .env file
 * 3. Run: node scripts/test-bloom-api.js
 *
 * Required packages:
 * - @supabase/supabase-js
 * - @salk-hpi/bloom-js
 */

import { createClient } from '@supabase/supabase-js';
import { SupabaseStore } from '@salk-hpi/bloom-js';

// TODO: Replace with your actual credentials from .env
const config = {
  bloom_api_url: process.env.BLOOM_API_URL || 'https://api.bloom.salk.edu/proxy',
  bloom_anon_key: process.env.BLOOM_ANON_KEY || 'your-anon-key-here',
  bloom_scanner_username: process.env.BLOOM_TEST_USERNAME || 'your-username@salk.edu',
  bloom_scanner_password: process.env.BLOOM_TEST_PASSWORD || 'your-password-here',
};

async function testBloomAPIConnection() {
  console.log('🔍 Testing Bloom API Connection with Supabase...');
  console.log(`📍 API URL: ${config.bloom_api_url}`);
  console.log(`👤 Username: ${config.bloom_scanner_username}`);
  console.log('');

  try {
    // Step 1: Create Supabase client
    console.log('1️⃣ Creating Supabase client...');
    const supabase = createClient(
      config.bloom_api_url,
      config.bloom_anon_key
    );

    // Step 2: Authenticate with email/password
    console.log('2️⃣ Authenticating with Supabase...');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: config.bloom_scanner_username,
      password: config.bloom_scanner_password,
    });

    if (authError) {
      console.error('❌ Authentication failed:');
      console.error(authError);
      return;
    }

    console.log('✅ Authentication successful!');
    console.log(`🔑 Access token: ${authData.session?.access_token?.substring(0, 30)}...`);
    console.log('');

    // Step 3: Query scanners using SupabaseStore
    console.log('3️⃣ Fetching scanners from cyl_scanners table...');
    const store = new SupabaseStore(supabase);
    const { data: scanners, error: scannersError } = await store.getAllCylScanners();

    if (scannersError) {
      console.error('❌ Error fetching scanners:');
      console.error(scannersError);
      return;
    }

    // Step 4: Display results
    console.log('✅ Success! Scanner list retrieved.');
    console.log('');
    console.log(`📊 Found ${scanners?.length || 0} scanners:`);
    console.log(JSON.stringify(scanners, null, 2));
    console.log('');

    scanners?.forEach((scanner, index) => {
      console.log(`  ${index + 1}. ID: ${scanner.id}, Name: ${scanner.name || '(null)'}`);
    });

    console.log('');
    console.log('🎉 Test completed successfully!');

  } catch (error) {
    console.error('❌ Unexpected error:');
    console.error(error);
  }
}

// Run the test
testBloomAPIConnection();
