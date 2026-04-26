#!/usr/bin/env ts-node
/**
 * AENEWS Growth Engine - Load Testing Script
 * Tests event ingestion pipeline with 100 and 1000 events
 */

import axios from 'axios';
import { performance } from 'perf_hooks';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_JWT = process.env.TEST_JWT || 'test-jwt-token';

interface LoadTestResult {
  totalEvents: number;
  successCount: number;
  errorCount: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number; // events per second
  duration: number; // milliseconds
}

/**
 * Generate random event data
 */
function generateEvent(userId: string, eventType: string): any {
  return {
    eventType,
    userId,
    timestamp: Date.now(),
    payload: {
      source: 'load-test',
      userAgent: 'Mozilla/5.0 Load Test',
      ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
      sessionId: `session-${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        test: true,
        random: Math.random()
      }
    }
  };
}

/**
 * Send single event and measure latency
 */
async function sendEvent(event: any): Promise<number> {
  const start = performance.now();
  
  try {
    await axios.post(`${API_URL}/events/track`, event, {
      headers: {
        'Authorization': `Bearer ${TEST_JWT}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    return performance.now() - start;
  } catch (error: any) {
    console.error(`Error sending event: ${error.message}`);
    throw error;
  }
}

/**
 * Run load test with specified number of events
 */
async function runLoadTest(
  numEvents: number,
  concurrency: number = 10
): Promise<LoadTestResult> {
  console.log(`\n🚀 Starting load test: ${numEvents} events, concurrency: ${concurrency}`);
  
  const eventTypes = ['page_view', 'form_submit', 'email_open', 'email_click', 'purchase'];
  const userIds = Array.from({ length: Math.ceil(numEvents / 10) }, (_, i) => `user-${i + 1}`);
  
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;
  
  const startTime = performance.now();
  
  // Process events in batches for controlled concurrency
  const batchSize = concurrency;
  const batches = Math.ceil(numEvents / batchSize);
  
  for (let batch = 0; batch < batches; batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, numEvents);
    const batchEvents = [];
    
    for (let i = batchStart; i < batchEnd; i++) {
      const userId = userIds[i % userIds.length];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const event = generateEvent(userId, eventType);
      
      batchEvents.push(
        sendEvent(event)
          .then(latency => {
            latencies.push(latency);
            successCount++;
          })
          .catch(() => {
            errorCount++;
          })
      );
    }
    
    await Promise.allSettled(batchEvents);
    
    // Progress
    if ((batch + 1) % 10 === 0 || batch === batches - 1) {
      const progress = ((batch + 1) / batches * 100).toFixed(1);
      console.log(`  Progress: ${progress}% (${batchEnd}/${numEvents} events)`);
    }
  }
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  // Calculate statistics
  latencies.sort((a, b) => a - b);
  
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const minLatency = latencies[0] || 0;
  const maxLatency = latencies[latencies.length - 1] || 0;
  const p50Latency = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99Latency = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const throughput = (successCount / duration) * 1000; // events per second
  
  return {
    totalEvents: numEvents,
    successCount,
    errorCount,
    avgLatency,
    minLatency,
    maxLatency,
    p50Latency,
    p95Latency,
    p99Latency,
    throughput,
    duration
  };
}

/**
 * Print results in a formatted table
 */
function printResults(results: LoadTestResult) {
  console.log('\n📊 Load Test Results:');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Total Events:     ${results.totalEvents}`);
  console.log(`Success:          ${results.successCount} (${((results.successCount / results.totalEvents) * 100).toFixed(2)}%)`);
  console.log(`Errors:           ${results.errorCount}`);
  console.log(`Duration:         ${results.duration.toFixed(2)} ms`);
  console.log(`Throughput:       ${results.throughput.toFixed(2)} events/sec`);
  console.log('───────────────────────────────────────────────────');
  console.log('Latency Statistics (ms):');
  console.log(`  Min:            ${results.minLatency.toFixed(2)}`);
  console.log(`  Avg:            ${results.avgLatency.toFixed(2)}`);
  console.log(`  P50 (Median):   ${results.p50Latency.toFixed(2)}`);
  console.log(`  P95:            ${results.p95Latency.toFixed(2)}`);
  console.log(`  P99:            ${results.p99Latency.toFixed(2)}`);
  console.log(`  Max:            ${results.maxLatency.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════\n');
  
  // Warnings
  if (results.errorCount > 0) {
    console.log(`⚠️  WARNING: ${results.errorCount} events failed`);
  }
  
  if (results.avgLatency > 100) {
    console.log(`⚠️  WARNING: Average latency (${results.avgLatency.toFixed(2)} ms) exceeds 100ms`);
  }
  
  if (results.p95Latency > 200) {
    console.log(`⚠️  WARNING: P95 latency (${results.p95Latency.toFixed(2)} ms) exceeds 200ms`);
  }
  
  // Success criteria
  const successRate = (results.successCount / results.totalEvents) * 100;
  if (successRate >= 99.9 && results.avgLatency < 100) {
    console.log('✅ All success criteria met!');
  } else {
    console.log('❌ Some success criteria not met');
  }
}

/**
 * Main test suite
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   AENEWS Growth Engine - Load Test Suite         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`API URL: ${API_URL}`);
  
  try {
    // Health check
    console.log('\n🔍 Checking API health...');
    const healthResponse = await axios.get(`${API_URL}/health`);
    console.log(`✅ API is healthy: ${JSON.stringify(healthResponse.data)}`);
    
    // Test 1: 100 events
    const results100 = await runLoadTest(100, 10);
    printResults(results100);
    
    // Wait before next test
    console.log('\n⏳ Waiting 5 seconds before next test...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test 2: 1000 events
    const results1000 = await runLoadTest(1000, 20);
    printResults(results1000);
    
    // Summary
    console.log('\n📈 Summary:');
    console.log('═══════════════════════════════════════════════════');
    console.log('Test 1 (100 events):');
    console.log(`  Throughput: ${results100.throughput.toFixed(2)} events/sec`);
    console.log(`  Avg Latency: ${results100.avgLatency.toFixed(2)} ms`);
    console.log(`  Success Rate: ${((results100.successCount / results100.totalEvents) * 100).toFixed(2)}%`);
    console.log('');
    console.log('Test 2 (1000 events):');
    console.log(`  Throughput: ${results1000.throughput.toFixed(2)} events/sec`);
    console.log(`  Avg Latency: ${results1000.avgLatency.toFixed(2)} ms`);
    console.log(`  Success Rate: ${((results1000.successCount / results1000.totalEvents) * 100).toFixed(2)}%`);
    console.log('═══════════════════════════════════════════════════');
    
    process.exit(0);
    
  } catch (error: any) {
    console.error(`\n❌ Load test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  main();
}

export { runLoadTest, LoadTestResult };
