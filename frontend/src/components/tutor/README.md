# AI Tutor Chat Panel

Context-aware chat interface for the AI Tutor that maintains conversation history linked to specific questions.

## Features

- **Slide-over Panel**: Smooth animation from the right side
- **Context-Aware**: Captures `questionId` and `studentAnswer` when opened
- **Streaming Responses**: Token-by-token streaming for conversational feel
- **History Persistence**: Saves chat transcripts to IndexedDB linked to `questionId`
- **Offline Support**: Chat history persists across page reloads

## Usage

### Basic Example

```tsx
import { useState } from 'react';
import ChatPanel from '@/src/components/tutor/ChatPanel';

function ExamPage() {
  const [isTutorOpen, setIsTutorOpen] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState({
    id: 'question_123',
    text: 'Solve for x: 2x + 5 = 13',
  });
  const [studentAnswer, setStudentAnswer] = useState(null);

  const handleWrongAnswer = (selectedAnswer: string) => {
    setStudentAnswer(selectedAnswer);
    setIsTutorOpen(true);
  };

  return (
    <>
      <button onClick={() => setIsTutorOpen(true)}>
        Get Help from AI Tutor
      </button>

      <ChatPanel
        isOpen={isTutorOpen}
        onClose={() => setIsTutorOpen(false)}
        questionId={currentQuestion.id}
        sessionId="session_123"
        studentAnswer={studentAnswer}
        questionText={currentQuestion.text}
      />
    </>
  );
}
```

### Integration with Exam Page

```tsx
// In your exam page component
import ChatPanel from '@/src/components/tutor/ChatPanel';

export default function ExamPage() {
  const [showTutor, setShowTutor] = useState(false);
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [wrongAnswer, setWrongAnswer] = useState<string | number | undefined>();

  const handleAnswerSubmit = async (answer: string) => {
    const isCorrect = await checkAnswer(answer);
    
    if (!isCorrect) {
      setWrongAnswer(answer);
      setCurrentQuestionId(currentQuestion.id);
      setShowTutor(true); // Open tutor panel when wrong answer
    }
  };

  return (
    <div>
      {/* Your exam UI */}
      
      <ChatPanel
        isOpen={showTutor}
        onClose={() => setShowTutor(false)}
        questionId={currentQuestionId || ''}
        sessionId={sessionId}
        studentAnswer={wrongAnswer}
        questionText={currentQuestion?.text}
      />
    </div>
  );
}
```

## Props

### ChatPanelProps

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | `boolean` | Yes | Whether the panel is open |
| `onClose` | `() => void` | Yes | Callback when panel is closed |
| `questionId` | `string` | Yes | ID of the question for context |
| `sessionId` | `string` | Yes | Current exam session ID |
| `studentAnswer` | `string \| number` | No | Student's wrong answer (for context) |
| `questionText` | `string` | No | Question text to display in header |

## Hook: useTutorSession

The `useTutorSession` hook manages the chat session state:

```tsx
import { useTutorSession } from '@/src/components/tutor/useTutorSession';

const {
  state,
  sendMessage,
  initializeSession,
  loadHistory,
  clearSession,
} = useTutorSession();
```

### State

```tsx
interface TutorSessionState {
  messages: ChatMessage[];      // Array of chat messages
  isStreaming: boolean;          // Whether response is streaming
  error: string | null;          // Error message if any
  isInitialized: boolean;       // Whether session is initialized
}
```

### Methods

- **`sendMessage(message: string)`**: Send a message and stream the response
- **`initializeSession(questionId, sessionId, studentAnswer?)`**: Initialize session with context
- **`loadHistory(questionId, sessionId)`**: Load existing chat history
- **`clearSession()`**: Clear current session

## Database Schema

Chat transcripts are stored in IndexedDB:

```typescript
interface TutorChatRecord {
  questionId: string;
  sessionId: string;
  messages: Array<{
    role: 'student' | 'tutor';
    content: string;
    timestamp: number;
  }>;
  studentAnswer?: string | number;
  createdAt: number;
  updatedAt: number;
}
```

Primary key: `[questionId, sessionId]` (compound key)

## Backend API

The component requires these backend endpoints:

### POST `/api/tutor/initialize`

Initialize a tutor session with question context.

**Request:**
```json
{
  "questionId": "question_123",
  "sessionId": "session_456",
  "studentAnswer": "5"
}
```

**Response:**
```json
{
  "initialMessage": "I see you're working on...",
  "success": true
}
```

### POST `/api/tutor/chat/stream`

Stream tutor responses (Server-Sent Events).

**Request:**
```json
{
  "questionId": "question_123",
  "sessionId": "session_456",
  "message": "I don't understand this step",
  "conversationHistory": [...]
}
```

**Response:** SSE stream with `data: {"content": "token"}` events

## Styling

The component uses CSS modules. Customize styles in `ChatPanel.module.css`:

- `.panel`: Main panel container
- `.messagesContainer`: Messages area
- `.message`: Individual message styling
- `.inputArea`: Input area at bottom

## Keyboard Shortcuts

- **Escape**: Close panel
- **Enter**: Send message (Shift+Enter for new line)

## Accessibility

- ARIA labels for screen readers
- Keyboard navigation support
- Focus management
- Semantic HTML structure
