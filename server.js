const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const CryptoJS = require('crypto-js'); // Import crypto-js
const express = require('express');
const cors = require('cors');
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
setInterval(processEmailQueue,  1200000 );  // Check every 10 seconds

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










// ..............................................Function to send a reset password email...............................................................................................

app.use(express.json());
app.use(cors());

async function sendResetPasswordEmail(userEmail, role, resetToken) {
  const resetLink = `${process.env.BASE_URL}/reset-password?token=${resetToken}&role=${role}`;

  const mailOptions = {
    from: `"Just2Kleen" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: 'Reset Your Just2Kleen Password',
    text: `You requested a password reset. Please click the link below to reset your password:\n\n${resetLink}\n\nIf you did not request this, please ignore this email.`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.response);
  } catch (error) {
    console.error('Error sending password reset email:', error);
  }
}



const crypto = require('crypto'); // Built-in crypto for random token generation
 // crypto-js for password hashing

// Endpoint to handle password reset
app.post('/reset-password', async (req, res) => {
  const { token, role, newPassword } = req.body;
  const tableName = role === 'cleaner' ? 'cleaners_main_profiles' : 'clients_main_profiles';

  try {
    // Verify the token and check expiry
    const { data: user, error } = await supabase
      .from(tableName)
      .select('id, token_expiry')
      .eq('reset_token', token)
      .single();

    if (error || !user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Check if the token has expired
    if (new Date(user.token_expiry) < new Date()) {
      return res.status(400).json({ message: 'Token has expired' });
    }

    // Hash the new password using crypto-js
    const hashedPassword = CryptoJS.SHA256(newPassword).toString();
    console.log('Hashed Password:', hashedPassword);

    // Update the user's password and clear the reset token and expiry
    const { error: updateError } = await supabase
      .from(tableName)
      .update({ password: hashedPassword, reset_token: null, token_expiry: null })
      .eq('id', user.id);

    if (updateError) {
      return res.status(500).json({ message: 'Failed to reset password' });
    }

    res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Internal server error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Endpoint to handle forgot password requests
app.post('/forgot-password', async (req, res) => {
  const { email, role } = req.body;
  const tableName = role === 'cleaner' ? 'cleaners_main_profiles' : 'clients_main_profiles';

  try {
    // Check if user exists
    const { data: user, error } = await supabase
      .from(tableName)
      .select('id, email')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate a reset token and expiry time (now + 2 hours)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 2 * 3600000); // Token valid for 2 hours (2 hours * 60 minutes * 60 seconds * 1000 milliseconds)
    console.log('Token Generated At:', new Date(Date.now())); // Log the generation time
    console.log('Token Expiry:', tokenExpiry); // Log to verify expiry time

    // Update user's record with reset token and expiry
    const { data: updatedUser, error: updateError } = await supabase
      .from(tableName)
      .update({ 
        reset_token: resetToken, 
        token_expiry: tokenExpiry.toISOString() // Ensure it's stored in ISO string format
      })
      .eq('email', email);

    if (updateError) {
      console.error('Error updating reset token:', updateError);
      return res.status(500).json({ message: 'Error updating reset token' });
    }

    console.log('Updated User with Expiry:', updatedUser); // Log updated user for debugging
    console.log('Update successful'); // Confirmation that update is completed

    // Send reset email
    await sendResetPasswordEmail(email, role, resetToken);
    res.status(200).json({ message: 'Password reset email sent' });
  } catch (err) {
    console.error('Internal server error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
