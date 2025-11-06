const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Book title is required'],
    trim: true
  },
  author: {
    type: String,
    required: [true, 'Book author is required'],
    trim: true
  },
  isbn: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  genre: {
    type: String,
    default: 'General',
    trim: true
  },
  available: {
    type: Boolean,
    default: true
  },
  addedDate: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Book', bookSchema);