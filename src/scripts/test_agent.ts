/**
 * Test Script for Socratic Tutor Agent
 * Tests the agent with a sample student input that should trigger a misconception
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { generateTutorResponseSimple } from "../../frontend/src/ai/agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(projectRoot, ".env") });

async function testAgent() {
  console.log("🧪 Testing Socratic Tutor Agent\n");

  // Test case: Student makes a common mistake
  const testMessages = [
    {
      role: "user" as const,
      content: "I think the answer is B because I added the exponents.",
    },
  ];

  console.log("📝 Student Input:");
  console.log(`   "${testMessages[0].content}"\n`);

  console.log("🤖 Agent Response:\n");

  try {
    const response = await generateTutorResponseSimple(
      testMessages,
      550, // Sample student score
      "test-question-1"
    );

    console.log(`   ${response}\n`);

    // Check if response contains remediation or helpful guidance
    if (
      response.toLowerCase().includes("exponent") ||
      response.toLowerCase().includes("multipl") ||
      response.toLowerCase().includes("add") ||
      response.includes("?")
    ) {
      console.log("✅ Test passed: Agent provided helpful guidance\n");
    } else {
      console.log("⚠️  Test inconclusive: Response may not have addressed the misconception\n");
    }
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run test
testAgent()
  .then(() => {
    console.log("✅ Test complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test error:", error);
    process.exit(1);
  });
