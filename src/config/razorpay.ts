import Razorpay from 'razorpay';

// Single shared Razorpay client used by both order creation and order fetch
// (signature verification). Keep key handling in one place.
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'default_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'default_key_secret',
});

export default razorpayInstance;
