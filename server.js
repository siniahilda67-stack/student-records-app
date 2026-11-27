  const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Settings (change these if you want) ----
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
// Separate database so your UniversityDB test data stays untouched
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/StudentRecordsDB';

mongoose
  .connect(MONGO_URL)
  .then(() => console.log('Connected to MongoDB: StudentRecordsDB'))
  .catch((err) => console.error('MongoDB connection failed:', err.message));

// ---- Models (these become your collections) ----
const Student = mongoose.model(
  'Student',
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      regNo: { type: String, required: true, unique: true, trim: true, uppercase: true },
      course: { type: String, required: true, trim: true },
    },
    { timestamps: true }
  )
);

const Complaint = mongoose.model(
  'Complaint',
  new mongoose.Schema(
    {
      regNo: { type: String, required: true, trim: true, uppercase: true },
      issue: { type: String, required: true, trim: true },
      details: { type: String, default: '', trim: true },
      status: { type: String, enum: ['Pending', 'In Progress', 'Resolved'], default: 'Pending' },
    },
    { timestamps: true }
  )
);

// ---- Helpers ----
const isAdmin = (req) => req.get('x-admin-pin') === ADMIN_PIN;

function adminOnly(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Wrong admin PIN' });
  next();
}

function cleanReg(value) {
  return String(value || '').trim().toUpperCase();
}

function sendError(res, err) {
  if (err.code === 11000) return res.status(400).json({ error: 'That registration number already exists' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: 'Please fill in all required fields' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

// ---- Student side ----
// Look up a student by registration number
app.get('/api/student', async (req, res) => {
  try {
    const student = await Student.findOne({ regNo: cleanReg(req.query.regNo) });
    if (!student) return res.status(404).json({ error: 'No student found with that registration number' });
    res.json(student);
  } catch (err) {
    sendError(res, err);
  }
});

// A student's own complaints
app.get('/api/complaints', async (req, res) => {
  try {
    const regNo = cleanReg(req.query.regNo);
    const complaints = await Complaint.find({ regNo }).sort({ createdAt: -1 });
    res.json(complaints);
  } catch (err) {
    sendError(res, err);
  }
});

// CREATE a complaint
app.post('/api/complaints', async (req, res) => {
  try {
    const regNo = cleanReg(req.body.regNo);
    const student = await Student.findOne({ regNo });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const complaint = await Complaint.create({
      regNo,
      issue: req.body.issue,
      details: req.body.details,
    });
    res.status(201).json(complaint);
  } catch (err) {
    sendError(res, err);
  }
});

// UPDATE a complaint (student can edit only while Pending)
app.put('/api/complaints/:id', async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (complaint.regNo !== cleanReg(req.body.regNo)) return res.status(403).json({ error: 'Not your complaint' });
    if (complaint.status !== 'Pending') return res.status(400).json({ error: 'Only pending complaints can be edited' });
    complaint.issue = req.body.issue;
    complaint.details = req.body.details;
    await complaint.save();
    res.json(complaint);
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE a complaint (student while Pending, or admin any time)
app.delete('/api/complaints/:id', async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (!isAdmin(req)) {
      if (complaint.regNo !== cleanReg(req.query.regNo)) return res.status(403).json({ error: 'Not your complaint' });
      if (complaint.status !== 'Pending') return res.status(400).json({ error: 'Only pending complaints can be deleted' });
    }
    await complaint.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// ---- Admin side ----
// READ all students
app.get('/api/students', adminOnly, async (req, res) => {
  try {
    res.json(await Student.find().sort({ createdAt: -1 }));
  } catch (err) {
    sendError(res, err);
  }
});

// CREATE a student
app.post('/api/students', adminOnly, async (req, res) => {
  try {
    const { name, regNo, course } = req.body;
    res.status(201).json(await Student.create({ name, regNo, course }));
  } catch (err) {
    sendError(res, err);
  }
});

// UPDATE a student
app.put('/api/students/:id', adminOnly, async (req, res) => {
  try {
    const { name, regNo, course } = req.body;
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { name, regNo: cleanReg(regNo), course },
      { new: true, runValidators: true }
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE a student
app.delete('/api/students/:id', adminOnly, async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// READ all complaints
app.get('/api/complaints/all', adminOnly, async (req, res) => {
  try {
    res.json(await Complaint.find().sort({ createdAt: -1 }));
  } catch (err) {
    sendError(res, err);
  }
});

// UPDATE complaint status
app.put('/api/complaints/:id/status', adminOnly, async (req, res) => {
  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    res.json(complaint);
  } catch (err) {
    sendError(res, err);
  }
});

app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
