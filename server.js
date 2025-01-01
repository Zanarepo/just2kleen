const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const express = require('express');
require('dotenv').config();

// Create Express server
const app = express();
const port = process.env.PORT || 4000;  // Set your desired port here

// Load Supabase credentials
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Nodemailer transport setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 465, // Secure SMTP port
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Function to generate a verification token
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex'); // 32-byte random token
}

// Function to send a confirmation email with a verification link
async function sendConfirmationEmail(userEmail, userName, verificationToken) {
  const confirmationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;

  const mailOptions = {
    from: `"Just2Kleen" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: 'Welcome to Just2Kleen! Please Confirm Your Email',
    text: `Hello ${userName},\n\nThank you for registering with Just2Kleen! Please confirm your email by clicking the link below:\n\n${confirmationLink}\n\nIf you did not register, please ignore this email.\n\nBest regards,\nThe Just2Kleen Team`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Confirmation email sent successfully:', info.response);
  } catch (error) {
    console.error('Error sending confirmation email:', error);
  }
}

// Function to fetch unverified users, generate tokens, and send emails
async function processEmailQueue() {
  // Fetch unverified users from the 'cleaners_main_profiles' table in Supabase
  const { data, error } = await supabase
    .from('cleaners_main_profiles')  // Adjust this to your actual table name
    .select('email, full_name, verification_token')  // Retrieve email and name of the users
    .eq('is_verified', false);  // Assuming you have an 'is_verified' column

  if (error) {
    console.error('Error retrieving users:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No unverified users found.');
    return;
  }

  // Loop through each unverified user
  for (const user of data) {
    const { email, full_name, verification_token } = user;

    // Check if the verification token exists; if not, generate one
    let token = verification_token;

    if (!token) {
      token = generateVerificationToken();  // Generate a new token
      // Update the user's record with the generated token
      const { error: updateError } = await supabase
        .from('cleaners_main_profiles')  // Adjust table name if necessary
        .update({ verification_token: token })
        .eq('email', email);  // Update the record by email

      if (updateError) {
        console.error('Error updating verification token:', updateError);
        continue; // Skip to the next user if an error occurs
      }
    }

    // Send the confirmation email
    await sendConfirmationEmail(email, full_name, token);

    console.log('Processed email verification for:', email);
  }
}

// Periodically check and process the queue
setInterval(processEmailQueue,  60000 );  // Check every 10 seconds

// Route to handle email verification with the token
app.get('/verify-email', async (req, res) => {
  const token = req.query.token;  // Get token from query parameters

  if (!token) {
    return res.status(400).send('Token is missing');
  }

  // Check if the token exists in the database
  const { data, error } = await supabase
    .from('cleaners_main_profiles')
    .select('id, email, is_verified, verification_token')
    .eq('verification_token', token)
    .single();  // Fetch one record

  if (error || !data) {
    return res.status(400).send('Invalid verification token');
  }

  // If the user is already verified, no further action is needed
  if (data.is_verified) {
    return res.send('Email is already verified');
  }

  // Update the user to set 'is_verified' to true and remove the token
  const { error: updateError } = await supabase
    .from('cleaners_main_profiles')
    .update({ is_verified: true, verification_token: null }) // Remove token after verification
    .eq('id', data.id);  // Assuming 'id' is the primary key

  if (updateError) {
    return res.status(500).send('Failed to verify email');
  }

  res.send('Email successfully verified');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
