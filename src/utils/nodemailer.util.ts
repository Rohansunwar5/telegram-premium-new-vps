import nodemailer from 'nodemailer';
import config from '../config';

export const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, 
  auth: {
    user: config.GMAIL_USER,
    pass: config.GMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false 
  }
});
