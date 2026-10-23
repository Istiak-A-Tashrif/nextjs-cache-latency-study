import fs from "fs";

// ---------------- CONFIG ----------------
const API_URL = "http://localhost:5001/api/products";
const RUNS = 20;
const OUTPUT_DIR = "results";

// Define all scenarios to test
const SCENARIOS = [
  { page: 1, limit: 10 },
  { page: 5, limit: 10 },
  { page: 10, limit: 10 },
  { page: 50, limit: 10 },
  { page: 1, limit: 25 },
  { page: 5, limit: 25 },
  { page: 10, limit: 25 },
  { page: 50, limit: 25 },
  { page: 1, limit: 50 },
  { page: 5, limit: 50 },
  { page: 10, limit: 50 },
  { page: 50, limit: 50 },
  { page: 1, limit: 100 },
  { page: 5, limit: 100 },
  { page: 10, limit: 100 },
  { page: 50, limit: 100 }
];

// ----------------------------------------

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values) {
  const avg = mean(values);
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

async function runBenchmarkForScenario(page, limit) {
  const backendTimes = [];
  const dbTimes = [];
  let redisHits = 0;
  let cacheStrategyLabel = "Unknown";

  const logs = [];

  for (let i = 1; i <= RUNS; i++) {
    try {
      const res = await fetch(`${API_URL}?page=${page}&limit=${limit}`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const json = await res.json();

      const {
        backendProcessingTime,
        dbTime,
        redisHit,
        cacheStrategy,
        timestamp,
      } = json.metrics;

      cacheStrategyLabel = cacheStrategy;

      backendTimes.push(backendProcessingTime);
      dbTimes.push(dbTime);
      if (redisHit) redisHits++;

      logs.push(
        `Run ${i} | Backend: ${backendProcessingTime} ms | DB: ${dbTime} ms | RedisHit: ${redisHit} | Time: ${timestamp}`
      );

      // Small delay to avoid burst bias
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      console.error(`Error in scenario page=${page}, limit=${limit}, run ${i}:`, error.message);
      logs.push(`Run ${i} | ERROR: ${error.message}`);
    }
  }

  const backendMean = backendTimes.length > 0 ? mean(backendTimes) : 0;
  const backendStd = backendTimes.length > 0 ? stdDev(backendTimes) : 0;
  const dbMean = dbTimes.length > 0 ? mean(dbTimes) : 0;
  const dbStd = dbTimes.length > 0 ? stdDev(dbTimes) : 0;

  const summary = `
==================== SUMMARY ====================
Page: ${page}
Limit: ${limit}
Runs: ${RUNS}
Successful Runs: ${backendTimes.length}/${RUNS}
Cache Strategy: ${cacheStrategyLabel}

Backend Processing Time:
  Mean: ${backendMean.toFixed(2)} ms
  Std Dev: ${backendStd.toFixed(2)} ms

DB Time:
  Mean: ${dbMean.toFixed(2)} ms
  Std Dev: ${dbStd.toFixed(2)} ms

Redis Hit Ratio:
  ${((redisHits / (backendTimes.length || 1)) * 100).toFixed(1)} %
================================================
`;

  const output = `
==================== RAW RUNS ====================
${logs.join("\n")}

${summary}
`;

  return {
    page,
    limit,
    backendMean,
    backendStd,
    dbMean,
    dbStd,
    redisHitRatio: (redisHits / (backendTimes.length || 1)) * 100,
    cacheStrategy: cacheStrategyLabel,
    output,
    successfulRuns: backendTimes.length
  };
}

async function runAllBenchmarks() {
  // Create results directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allResults = [];
  const combinedOutput = [];

  console.log(`🚀 Starting benchmark for ${SCENARIOS.length} scenarios...`);

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    console.log(`\n📊 Running scenario ${i + 1}/${SCENARIOS.length}: page=${scenario.page}, limit=${scenario.limit}`);
    
    const startTime = Date.now();
    const result = await runBenchmarkForScenario(scenario.page, scenario.limit);
    const elapsedTime = Date.now() - startTime;
    
    result.elapsedTime = elapsedTime;
    allResults.push(result);
    
    // Save individual scenario results
    const individualFilename = `${OUTPUT_DIR}/products_page${scenario.page}_limit${scenario.limit}.txt`;
    fs.writeFileSync(individualFilename, result.output);
    
    // Add to combined output
    combinedOutput.push(`\n${'='.repeat(60)}`);
    combinedOutput.push(`SCENARIO: Page=${scenario.page}, Limit=${scenario.limit} (${elapsedTime}ms)`);
    combinedOutput.push(`Successful: ${result.successfulRuns}/${RUNS}`);
    combinedOutput.push(`Backend: ${result.backendMean.toFixed(2)}ms ± ${result.backendStd.toFixed(2)}ms`);
    combinedOutput.push(`DB: ${result.dbMean.toFixed(2)}ms ± ${result.dbStd.toFixed(2)}ms`);
    combinedOutput.push(`Redis Hit: ${result.redisHitRatio.toFixed(1)}%`);
    combinedOutput.push(`Cache: ${result.cacheStrategy}`);
    
    console.log(`✅ Completed in ${elapsedTime}ms - Saved to ${individualFilename}`);
  }

  // Generate summary report
  generateSummaryReport(allResults);
  
  console.log(`\n🎉 All ${SCENARIOS.length} scenarios completed!`);
  console.log(`📊 Summary report saved to ${OUTPUT_DIR}/summary_report.txt`);
}

function generateSummaryReport(results) {
  const summaryLines = [];
  
  summaryLines.push('='.repeat(80));
  summaryLines.push('COMPREHENSIVE BENCHMARK SUMMARY');
  summaryLines.push('='.repeat(80));
  summaryLines.push('');
  
  // Table header
  summaryLines.push(
    'Page'.padEnd(6) +
    'Limit'.padEnd(8) +
    'Success'.padEnd(10) +
    'Backend (ms)'.padEnd(18) +
    'DB (ms)'.padEnd(18) +
    'Redis Hit %'.padEnd(15) +
    'Cache Strategy'
  );
  summaryLines.push('-'.repeat(80));
  
  // Table rows
  results.forEach(result => {
    summaryLines.push(
      result.page.toString().padEnd(6) +
      result.limit.toString().padEnd(8) +
      `${result.successfulRuns}/${RUNS}`.padEnd(10) +
      `${result.backendMean.toFixed(2)} ± ${result.backendStd.toFixed(2)}`.padEnd(18) +
      `${result.dbMean.toFixed(2)} ± ${result.dbStd.toFixed(2)}`.padEnd(18) +
      `${result.redisHitRatio.toFixed(1)}%`.padEnd(15) +
      result.cacheStrategy
    );
  });
  
  summaryLines.push('');
  summaryLines.push('='.repeat(80));
  
  // Calculate averages
  const avgBackend = mean(results.map(r => r.backendMean));
  const avgDB = mean(results.map(r => r.dbMean));
  const avgRedisHit = mean(results.map(r => r.redisHitRatio));
  const totalTime = results.reduce((sum, r) => sum + r.elapsedTime, 0);
  
  summaryLines.push('\nOVERALL AVERAGES:');
  summaryLines.push(`Average Backend Time: ${avgBackend.toFixed(2)} ms`);
  summaryLines.push(`Average DB Time: ${avgDB.toFixed(2)} ms`);
  summaryLines.push(`Average Redis Hit Ratio: ${avgRedisHit.toFixed(1)}%`);
  summaryLines.push(`Total Benchmark Time: ${(totalTime / 1000).toFixed(1)} seconds`);
  summaryLines.push(`Scenarios Tested: ${results.length}`);
  summaryLines.push('');
  summaryLines.push('='.repeat(80));
  
  const summaryReport = summaryLines.join('\n');
  fs.writeFileSync(`${OUTPUT_DIR}/summary_report.txt`, summaryReport);
  
  // Also log to console
  console.log('\n📋 SUMMARY REPORT:');
  console.log(summaryReport);
}

// Error handling for the main execution
runAllBenchmarks().catch(error => {
  console.error('❌ Fatal error running benchmarks:', error);
  process.exit(1);
});