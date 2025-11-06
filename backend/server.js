const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔗 Connecting to MongoDB Atlas...');

let isDBConnected = false;

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ SUCCESS: Connected to MongoDB Atlas!');
    console.log('📊 Database:', mongoose.connection.name);
    isDBConnected = true;
  })
  .catch(err => {
    console.log('❌ FAILED: MongoDB connection error:');
    console.log('   ', err.message);
  });

// Import Book model
const Book = require('./models/Book');

// ===== ROUTES =====

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: '🎉 Library API is working!', 
    status: 'success',
    database: isDBConnected ? 'connected' : 'connecting...',
    timestamp: new Date().toISOString()
  });
});

// Import models
const Transaction = require('./models/Transaction');
const Payment = require('./models/Payment');

// Transaction Routes
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().populate('book').sort({ createdDate: -1 });
    res.json({ success: true, transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Borrow a book
app.post('/api/transactions/borrow', async (req, res) => {
  try {
    const { bookId, studentId, studentName, studentDepartment, days = 14 } = req.body;
    
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }
    
    if (book.available <= 0) {
      return res.status(400).json({ success: false, error: 'Book not available' });
    }

    const borrowDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(borrowDate.getDate() + days);

    const transaction = new Transaction({
      book: bookId,
      student: {
        studentId,
        name: studentName,
        department: studentDepartment
      },
      borrowDate,
      dueDate
    });

    await transaction.save();
    
    // Update book availability
    book.available -= 1;
    await book.save();

    res.json({
      success: true,
      message: 'Book issued successfully',
      transaction: await transaction.populate('book')
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Return a book
app.post('/api/transactions/return/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id).populate('book');
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const returnDate = new Date();
    const dueDate = new Date(transaction.dueDate);
    const daysLate = Math.max(0, Math.floor((returnDate - dueDate) / (1000 * 60 * 60 * 24)));
    const fineAmount = daysLate * 5;

    transaction.returnDate = returnDate;
    transaction.daysLate = daysLate;
    transaction.fineAmount = fineAmount;
    transaction.status = daysLate > 0 ? 'returned_late' : 'returned';

    await transaction.save();

    // Update book availability
    await Book.findByIdAndUpdate(transaction.book._id, {
      $inc: { available: 1 }
    });

    res.json({
      success: true,
      message: `Book returned successfully${fineAmount > 0 ? ` (Fine: ₹${fineAmount})` : ''}`,
      transaction
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Payment Routes
app.post('/api/payments/create-upi', async (req, res) => {
  try {
    const { transactionId, studentId, studentName, amount } = req.body;
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    
    // Create payment record
    const payment = new Payment({
      transactionId,
      studentId,
      studentName,
      amount,
      upiId: 'raitlibrary@axisbank'
    });
    
    await payment.save();
    
    res.json({
      success: true,
      payment: {
        _id: payment._id,
        amount: payment.amount,
        upiId: payment.upiId,
        status: payment.paymentStatus
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify payment
app.post('/api/payments/verify', async (req, res) => {
  try {
    const { paymentId, utrNumber } = req.body;
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }
    
    payment.paymentStatus = 'completed';
    payment.utrNumber = utrNumber || `UTR${Date.now()}`;
    payment.paymentDate = new Date();
    
    await payment.save();
    
    // Update transaction fine status
    await Transaction.findByIdAndUpdate(payment.transactionId, {
      finePaid: true,
      finePaidDate: new Date()
    });
    
    res.json({
      success: true,
      message: 'Payment verified successfully!',
      payment: payment
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark fine as paid directly
app.put('/api/transactions/:id/pay-fine', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    
    transaction.finePaid = true;
    transaction.finePaidDate = new Date();
    await transaction.save();
    
    res.json({
      success: true,
      message: 'Fine payment recorded successfully!',
      transaction: transaction
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check - IMPROVED
app.get('/api/health', (req, res) => {
  const dbStatus = isDBConnected ? 'connected' : 'connecting...';
  res.json({ 
    status: 'healthy 🏥',
    database: dbStatus,
    databaseName: mongoose.connection.name || 'libraryDB',
    timestamp: new Date().toISOString()
  });
});

// Get all books
app.get('/api/books', async (req, res) => {
  if (!isDBConnected) {
    return res.status(503).json({ 
      success: false, 
      error: 'Database connecting, please try again' 
    });
  }
  
  try {
    const books = await Book.find();
    res.json({ 
      success: true, 
      count: books.length,
      books 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add new book
app.post('/api/books', async (req, res) => {
  if (!isDBConnected) {
    return res.status(503).json({ 
      success: false, 
      error: 'Database connecting, please try again' 
    });
  }
  
  try {
    const { title, author, isbn, genre } = req.body;
    
    if (!title || !author) {
      return res.status(400).json({ 
        success: false, 
        error: 'Title and author are required' 
      });
    }

    const newBook = new Book({ 
      title, 
      author, 
      isbn, 
      genre 
    });
    
    await newBook.save();
    
    res.status(201).json({ 
      success: true, 
      message: 'Book added successfully!',
      book: newBook 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('⏳ Waiting for database connection...');
});

// Handle connection events
mongoose.connection.on('connected', () => {
  console.log('💾 MongoDB connected successfully!');
  isDBConnected = true;
});

mongoose.connection.on('error', (err) => {
  console.log('❌ MongoDB connection error:', err.message);
  isDBConnected = false;
});