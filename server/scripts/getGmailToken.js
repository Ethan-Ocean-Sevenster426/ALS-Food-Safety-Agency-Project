/**
 * One-time script to authorize Gmail access and get a refresh token.
 *
 * 1. Run: node scripts/getGmailToken.js
 * 2. Open the URL in your browser
 * 3. Sign in with the Gmail account you want to send emails FROM
 * 4. Copy the authorization code back here
 * 5. The refresh token will be saved to .env
 */
const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const credPath = path.join(__dirname, '..', '..', 'client_secret_779086013420-4pa0rjp3ei2vpakkmiff4ihgc93rppcs.apps.googleusercontent.com.json');
const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

const { client_id, client_secret, redirect_uris } = creds.web;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n=== Gmail Authorization ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nAfter authorizing, you will be redirected to a localhost URL.');
console.log('Copy the "code" parameter from the URL and paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Enter the authorization code: ', async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log('\nRefresh Token:', tokens.refresh_token);

    // Append to .env
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    if (!envContent.includes('GOOGLE_CLIENT_ID')) {
      envContent += `\nGOOGLE_CLIENT_ID=${client_id}`;
      envContent += `\nGOOGLE_CLIENT_SECRET=${client_secret}`;
      envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
      fs.writeFileSync(envPath, envContent);
      console.log('\nCredentials saved to .env!');
    } else {
      console.log('\nGoogle credentials already in .env. Manually update GOOGLE_REFRESH_TOKEN if needed:');
      console.log(tokens.refresh_token);
    }

    console.log('\nDone! You can now send emails from the app.');
  } catch (err) {
    console.error('Error getting token:', err.message);
  } finally {
    rl.close();
  }
});
