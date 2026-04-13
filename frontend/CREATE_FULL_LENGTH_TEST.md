# How to Create a Full-Length Test

This guide explains how to bundle your question JSON files into a full-length SAT exam that the app can use.

## Prerequisites

1. **Question JSON Files**: Place all your question JSON files in the `questions/` directory at the project root
2. **Node.js**: Make sure Node.js is installed (the script uses `fs` and `path` modules)

## Step-by-Step Instructions

### Step 1: Prepare Your Questions

Place all your question JSON files in:
```
Standard_Tests/
  └── questions/
      ├── question_001.json
      ├── question_002.json
      ├── question_003.json
      └── ... (all your question files)
```

**Question JSON Format:**
Each JSON file should contain a question object with these fields (the script handles multiple formats):
```json
{
  "id": "q1",
  "stem": "What is the main idea?",
  "passageText": "The passage discusses...",
  "choices": [
    { "id": "A", "text": "Option A" },
    { "id": "B", "text": "Option B" },
    { "id": "C", "text": "Option C" },
    { "id": "D", "text": "Option D" }
  ],
  "correct_answer": "B"
}
```

### Step 2: Run the Bundler Script

Open a terminal in the `frontend` directory and run:

```bash
cd frontend
node scripts/bundle-exam.js
```

**What it does:**
- Reads all `.json` files from `../../questions/` (project root `questions/` folder)
- Maps each question to a standardized format
- Creates a `content_bank` object (O(1) lookup for 3,000+ questions)
- Creates modules with `question_order` arrays
- Outputs to `frontend/public/sat-full.json`

### Step 3: Verify the Output

Check that `frontend/public/sat-full.json` was created. It should have this structure:

```json
{
  "exam_id": "sat-full",
  "config": {
    "total_time": 3600,
    "allowed_tools": ["calculator", "highlighter"]
  },
  "routing_logic": {
    "module_1_threshold": 12
  },
  "modules": [
    {
      "id": "rw_module_1",
      "type": "fixed",
      "question_order": ["q1", "q2", "q3", ...]
    }
  ],
  "content_bank": {
    "q1": {
      "id": "q1",
      "text": "What is the main idea?",
      "passageText": "...",
      "choices": [...],
      "correct_answer": "B"
    },
    ...
  }
}
```

### Step 4: Load the Test in the App

1. **Start your Next.js dev server** (if not already running):
   ```bash
   cd frontend
   npm run dev
   ```

2. **Open the Dashboard**: Navigate to `http://localhost:3000/dashboard`

3. **Click "🚀 Load Real Exam"** button (top-right corner)

4. **Confirm**: Click "OK" when prompted

5. **Wait for Load**: The app will:
   - Fetch `sat-full.json` from `/public/sat-full.json`
   - Clear existing IndexedDB data
   - Store the full exam packet
   - Create a new session
   - Reload the page

6. **Start the Exam**: Click "Resume" on the session in the dashboard, or navigate to:
   ```
   http://localhost:3000/exam/simulation/test-session-1
   ```

## Customization Options

### Adjust Time Limit

Edit `frontend/scripts/bundle-exam.js` line 156:
```javascript
total_time: 3600, // Change to your desired time in seconds
```

### Split into Multiple Modules

For a true adaptive test, you can split questions into Module 1 and Module 2 (Hard/Easy):

```javascript
// Split questions into two groups
const module1Questions = allQuestions.slice(0, 27); // First 27 questions
const module2HardQuestions = allQuestions.slice(27, 54); // Next 27 (hard)
const module2EasyQuestions = allQuestions.slice(54, 81); // Next 27 (easy)

const modules = [
  {
    id: 'rw_module_1',
    type: 'fixed',
    question_order: module1Questions.map(q => q.id)
  },
  {
    id: 'rw_module_2_hard',
    type: 'fixed',
    question_order: module2HardQuestions.map(q => q.id)
  },
  {
    id: 'rw_module_2_easy',
    type: 'fixed',
    question_order: module2EasyQuestions.map(q => q.id)
  }
];
```

### Change Exam ID

Edit line 154 in `bundle-exam.js`:
```javascript
exam_id: 'sat-full', // Change to your exam name
```

## Troubleshooting

### "Input directory not found"
- Make sure the `questions/` folder exists at the project root
- Check the path in `bundle-exam.js` line 7

### "Failed to load file" in browser
- Make sure `sat-full.json` is in `frontend/public/`
- Check browser console (F12) for detailed errors
- Verify the JSON is valid (use a JSON validator)

### Questions not showing
- Check browser console for errors
- Verify `content_bank` has question IDs matching `question_order`
- Use "🔍 Inspect DB" button to check IndexedDB contents

### Performance Issues with 3,000+ Questions
- The app is optimized for large datasets (O(1) lookups)
- If slow, check browser DevTools Performance tab
- Ensure images are optimized and in `frontend/public/extracted_images/`

## File Structure Summary

```
Standard_Tests/
├── questions/              # ← Put your JSON files here
│   ├── q1.json
│   ├── q2.json
│   └── ...
├── frontend/
│   ├── scripts/
│   │   └── bundle-exam.js  # ← Run this script
│   ├── public/
│   │   ├── sat-full.json   # ← Output file (auto-generated)
│   │   └── extracted_images/  # ← Put question images here
│   └── ...
```

## Next Steps

After creating your full-length test:
1. Test it thoroughly with a few questions
2. Verify images load correctly
3. Check that navigation works
4. Test the "Finish Section" flow
5. Verify answers are saved correctly

Happy testing! 🎓
