/**
 * PII Audit Script
 * 
 * Scans the SatPrepDB IndexedDB database and alerts if it finds PII
 * (Personally Identifiable Information) in non-secure tables.
 * 
 * Specifically checks for:
 * - Email addresses (containing "@" symbol)
 * - Names (common name patterns)
 * - User IDs that might be PII
 * 
 * Tables to audit:
 * - logs: Should only contain student_hash_id, never email/name
 * - responses: Should only contain student_hash_id, never email/name
 * - sessions: Should only contain session metadata, never email/name
 * - annotations: Should only contain annotation data, never email/name
 * 
 * Usage:
 * ```typescript
 * import { auditPII } from '@/src/scripts/audit-pii';
 * 
 * const results = await auditPII();
 * if (results.violations.length > 0) {
 *   console.error('PII violations found:', results.violations);
 * }
 * ```
 */

import { db } from '@/src/lib/db';
import { containsPII, sanitizeData } from '@/src/utils/security';

/**
 * PII Violation Record
 */
export interface PIIViolation {
  /** Table name where violation was found */
  table: string;
  
  /** Record ID or key where violation was found */
  recordId: string | number | [string, string];
  
  /** Field name where PII was found */
  field: string;
  
  /** The PII value that was found */
  value: string;
  
  /** Type of PII detected */
  piiType: 'email' | 'name' | 'unknown';
}

/**
 * Audit Results
 */
export interface AuditResults {
  /** Total records scanned */
  totalRecordsScanned: number;
  
  /** Number of violations found */
  violationCount: number;
  
  /** List of violations */
  violations: PIIViolation[];
  
  /** Whether audit passed (no violations) */
  passed: boolean;
  
  /** Timestamp of audit */
  timestamp: number;
}

/**
 * Email regex pattern
 */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Common name patterns (first/last names)
 */
const NAME_PATTERNS = [
  /\b(John|Jane|Mary|James|Robert|Michael|William|David|Richard|Joseph|Thomas|Charles|Christopher|Daniel|Matthew|Anthony|Mark|Donald|Steven|Paul|Andrew|Joshua|Kenneth|Kevin|Brian|George|Edward|Ronald|Timothy|Jason|Jeffrey|Ryan|Jacob|Gary|Nicholas|Eric|Jonathan|Stephen|Larry|Justin|Scott|Brandon|Benjamin|Frank|Gregory|Raymond|Alexander|Patrick|Jack|Dennis|Jerry|Tyler|Aaron|Jose|Henry|Adam|Douglas|Nathan|Zachary|Kyle|Noah|Ethan|Jeremy|Walter|Christian|Keith|Roger|Terry|Austin|Sean|Gerald|Carl|Harold|Dylan|Juan|Wayne|Roy|Ralph|Eugene|Louis|Philip|Bobby|Johnny|Willie|Lawrence|Randy|Vincent|Russell|Albert|Alan|Arthur|Joe|Juan|Willie|Bobby|Roy|Eugene|Ralph|Lawrence|Randy|Vincent|Russell|Albert|Alan|Arthur|Joe)\b/i,
  /\b(Smith|Johnson|Williams|Brown|Jones|Garcia|Miller|Davis|Rodriguez|Martinez|Hernandez|Lopez|Wilson|Anderson|Thomas|Taylor|Moore|Jackson|Martin|Lee|Thompson|White|Harris|Sanchez|Clark|Ramirez|Lewis|Robinson|Walker|Young|Allen|King|Wright|Scott|Torres|Nguyen|Hill|Flores|Green|Adams|Nelson|Baker|Hall|Rivera|Campbell|Mitchell|Carter|Roberts)\b/i,
];

/**
 * Recursively scan an object for PII
 */
function scanObjectForPII(
  obj: any,
  table: string,
  recordId: string | number | [string, string],
  path: string = '',
  violations: PIIViolation[] = []
): void {
  if (obj === null || obj === undefined) {
    return;
  }

  if (typeof obj === 'string') {
    // Check for email addresses
    if (EMAIL_PATTERN.test(obj)) {
      violations.push({
        table,
        recordId,
        field: path || 'value',
        value: obj,
        piiType: 'email',
      });
    }
    
    // Check for names (simple heuristic - check if string matches name patterns)
    for (const pattern of NAME_PATTERNS) {
      if (pattern.test(obj) && obj.length < 50) {
        // Only flag if it's a short string (likely a name, not text content)
        violations.push({
          table,
          recordId,
          field: path || 'value',
          value: obj,
          piiType: 'name',
        });
        break;
      }
    }
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      scanObjectForPII(item, table, recordId, `${path}[${index}]`, violations);
    });
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = path ? `${path}.${key}` : key;
      
      // Skip known safe fields
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === 'id' ||
        lowerKey === 'sessionid' ||
        lowerKey === 'questionid' ||
        lowerKey === 'timestamp' ||
        lowerKey === 'issynced' ||
        lowerKey === 'eventtype' ||
        lowerKey === 'object' ||
        lowerKey === 'verb'
      ) {
        continue;
      }
      
      // Check if field name suggests PII
      if (
        lowerKey.includes('email') ||
        lowerKey.includes('name') ||
        lowerKey.includes('user') && !lowerKey.includes('hash') ||
        lowerKey === 'username' ||
        lowerKey === 'firstname' ||
        lowerKey === 'lastname'
      ) {
        // This field name suggests PII - flag it
        violations.push({
          table,
          recordId,
          field: fieldPath,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          piiType: lowerKey.includes('email') ? 'email' : 'name',
        });
      }
      
      // Recursively scan nested objects
      scanObjectForPII(value, table, recordId, fieldPath, violations);
    }
  }
}

/**
 * Audit the logs table for PII
 */
async function auditLogsTable(): Promise<PIIViolation[]> {
  const violations: PIIViolation[] = [];
  
  try {
    const logs = await db.logs.toArray();
    
    for (const log of logs) {
      if (log.id === undefined) continue;
      
      // Check eventData for PII
      if (log.eventData) {
        scanObjectForPII(log.eventData, 'logs', log.id, 'eventData', violations);
      }
      
      // Check if actor field contains email (should be student_hash_id, not email)
      if (log.eventData?.actor && typeof log.eventData.actor === 'string') {
        if (EMAIL_PATTERN.test(log.eventData.actor)) {
          violations.push({
            table: 'logs',
            recordId: log.id,
            field: 'eventData.actor',
            value: log.eventData.actor,
            piiType: 'email',
          });
        }
      }
    }
  } catch (error) {
    console.error('[Audit] Error auditing logs table:', error);
  }
  
  return violations;
}

/**
 * Audit the responses table for PII
 */
async function auditResponsesTable(): Promise<PIIViolation[]> {
  const violations: PIIViolation[] = [];
  
  try {
    const responses = await db.responses.toArray();
    
    for (const response of responses) {
      const recordId: [string, string] = [response.sessionId, response.questionId];
      
      // Responses should not have any PII fields
      // Check all fields
      scanObjectForPII(response, 'responses', recordId, '', violations);
    }
  } catch (error) {
    console.error('[Audit] Error auditing responses table:', error);
  }
  
  return violations;
}

/**
 * Audit the sessions table for PII
 */
async function auditSessionsTable(): Promise<PIIViolation[]> {
  const violations: PIIViolation[] = [];
  
  try {
    const sessions = await db.sessions.toArray();
    
    for (const session of sessions) {
      // Check all fields for PII
      scanObjectForPII(session, 'sessions', session.id, '', violations);
    }
  } catch (error) {
    console.error('[Audit] Error auditing sessions table:', error);
  }
  
  return violations;
}

/**
 * Audit the annotations table for PII
 */
async function auditAnnotationsTable(): Promise<PIIViolation[]> {
  const violations: PIIViolation[] = [];
  
  try {
    const annotations = await db.annotations.toArray();
    
    for (const annotation of annotations) {
      const recordId: [string, string] = [annotation.sessionId, annotation.questionId];
      
      // Check all fields for PII
      scanObjectForPII(annotation, 'annotations', recordId, '', violations);
    }
  } catch (error) {
    console.error('[Audit] Error auditing annotations table:', error);
  }
  
  return violations;
}

/**
 * Main audit function
 * 
 * Scans all IndexedDB tables for PII violations.
 * 
 * @returns Promise<AuditResults> - Audit results with violations
 */
export async function auditPII(): Promise<AuditResults> {
  console.log('[Audit] Starting PII audit...');
  
  const violations: PIIViolation[] = [];
  let totalRecordsScanned = 0;
  
  // Audit each table
  try {
    // Audit logs table
    const logsViolations = await auditLogsTable();
    violations.push(...logsViolations);
    const logsCount = await db.logs.count();
    totalRecordsScanned += logsCount;
    console.log(`[Audit] Scanned ${logsCount} log records, found ${logsViolations.length} violations`);
    
    // Audit responses table
    const responsesViolations = await auditResponsesTable();
    violations.push(...responsesViolations);
    const responsesCount = await db.responses.count();
    totalRecordsScanned += responsesCount;
    console.log(`[Audit] Scanned ${responsesCount} response records, found ${responsesViolations.length} violations`);
    
    // Audit sessions table
    const sessionsViolations = await auditSessionsTable();
    violations.push(...sessionsViolations);
    const sessionsCount = await db.sessions.count();
    totalRecordsScanned += sessionsCount;
    console.log(`[Audit] Scanned ${sessionsCount} session records, found ${sessionsViolations.length} violations`);
    
    // Audit annotations table
    const annotationsViolations = await auditAnnotationsTable();
    violations.push(...annotationsViolations);
    const annotationsCount = await db.annotations.count();
    totalRecordsScanned += annotationsCount;
    console.log(`[Audit] Scanned ${annotationsCount} annotation records, found ${annotationsViolations.length} violations`);
  } catch (error) {
    console.error('[Audit] Error during audit:', error);
  }
  
  const results: AuditResults = {
    totalRecordsScanned,
    violationCount: violations.length,
    violations,
    passed: violations.length === 0,
    timestamp: Date.now(),
  };
  
  if (results.passed) {
    console.log('[Audit] ✅ PII audit passed - no violations found');
  } else {
    console.error(`[Audit] ❌ PII audit failed - found ${violations.length} violations`);
    violations.forEach((violation) => {
      console.error(
        `[Audit] Violation in ${violation.table} (${violation.recordId}): ` +
        `${violation.field} contains ${violation.piiType}: ${violation.value.substring(0, 50)}...`
      );
    });
  }
  
  return results;
}

/**
 * Run audit and return results (for use in browser console or automated testing)
 */
export async function runAudit(): Promise<void> {
  const results = await auditPII();
  
  if (results.passed) {
    console.log('✅ PII Audit Passed');
    console.log(`Scanned ${results.totalRecordsScanned} records with no violations`);
  } else {
    console.error('❌ PII Audit Failed');
    console.error(`Found ${results.violationCount} violations in ${results.totalRecordsScanned} records`);
    console.table(results.violations);
  }
  
  return;
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).auditPII = runAudit;
}
