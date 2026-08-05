const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const MANUAL_BY_ROLE = {
  'Super Admin':   'EPVS Super Admin User Manual',
  'Admin':         'EPVS Admin User Manual',
  'ALS':           'EPVS ALS User Manual',
  'Super':         'EPVS ALS User Manual', // legacy alias — pre-ALS-rename role name
  'Inspector':     'EPVS Inspector User Manual',
  'Company Admin': 'EPVS Company Admin User Manual',
  'User':          'EPVS User Manual',
};

const FORMATS = {
  pdf:  { ext: '.pdf',  mime: 'application/pdf' },
  docx: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
};

// GET /api/manuals?role=<role>&format=pdf|docx - stream the manual.
router.get('/', (req, res) => {
  const role = req.query.role || '';
  const format = (req.query.format || 'pdf').toLowerCase();

  const baseName = MANUAL_BY_ROLE[role];
  const fmt = FORMATS[format];
  if (!baseName) return res.status(400).json({ message: 'Unknown role.' });
  if (!fmt)      return res.status(400).json({ message: 'format must be pdf or docx.' });

  const fileName = baseName + fmt.ext;
  const filePath = path.join(__dirname, '..', '..', fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: `Manual file missing on server: ${fileName}` });
  }

  res.setHeader('Content-Type', fmt.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.sendFile(filePath);
});

module.exports = router;
