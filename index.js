require('dotenv').config();
const axios = require('axios');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

// Environment variables for configuration
const CLOCK_ADDRESS = process.env.CLOCK_ADDRESS;  // e.g. "192.168.1.100"
const CLOCK_USERNAME = process.env.CLOCK_USERNAME || 'monitoring';
const CLOCK_PASSWORD = process.env.CLOCK_PASSWORD || 'monitoring';

const INFLUX_URL = process.env.INFLUX_URL;           // e.g. "http://influxdb:8086"
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG;
const INFLUX_BUCKET = process.env.INFLUX_BUCKET;
const POLL_INTERVAL = process.env.POLL_INTERVAL || 60000; // poll interval in milliseconds

if (!CLOCK_ADDRESS || !INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !INFLUX_BUCKET) {
  console.error("Missing one or more required environment variables.");
  process.exit(1);
}

let hostHeader = { Host: CLOCK_ADDRESS  };
// Create InfluxDB client and write API
const influxDB = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influxDB.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ns');
// Use the clock address as a tag for easier filtering later
writeApi.useDefaultTags({ clock: CLOCK_ADDRESS });

// Function to poll the Meinberg clock and write metrics
async function pollClock() {
  try {
    // GET the clock status using basic auth
    const response = await axios.get(`https://${CLOCK_ADDRESS}/api/status`, {
      auth: {
        username: CLOCK_USERNAME,
        password: CLOCK_PASSWORD
      },
      headers: {
        'Content-Type': 'text/plain'
      },
      timeout: 5000 // 5 second timeout
    });
    const data = response.data;

    // Extract information from the JSON status
    const systemInfo = data['system-information'];
    const systemData = data.data.system;
    const syncStatus = systemData['sync-status'];
    const holdoverStatus = syncStatus ? syncStatus['holdover-status'] : null;

    // Create an InfluxDB point with key metrics
    const point = new Point('clock_status')
      .tag('serial_number', systemInfo['serial-number'])
      .tag('model', systemInfo.model)
      .floatField('uptime', systemData.uptime)
      .stringField('sync_clock_status', syncStatus && syncStatus['clock-status'] ? syncStatus['clock-status'].clock : 'unknown')
      .stringField('oscillator_status', syncStatus && syncStatus['clock-status'] ? syncStatus['clock-status'].oscillator : 'unknown')
      .stringField('reference_source', syncStatus ? syncStatus.reference : 'unknown')
      .stringField('estimated_time_quality', syncStatus ? syncStatus['est-time-quality'] : 'unknown');

    if (holdoverStatus) {
      point.floatField('holdover_time_offset', holdoverStatus['time-offset']);
      point.floatField('holdover_time_elapsed', holdoverStatus['time-elapsed']);
    }

    // Write the point to InfluxDB
    writeApi.writePoint(point);
    await writeApi.flush();
    console.log("Metrics written to InfluxDB at", new Date().toISOString());
  } catch (error) {
    console.error("Error polling clock:", error.message);
  }
}

// Poll immediately and then at the defined interval
pollClock();
setInterval(pollClock, POLL_INTERVAL);

// Graceful shutdown on SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log("Closing write API");
  try {
    await writeApi.close();
  } catch (err) {
    console.error("Error during InfluxDB client shutdown", err);
  }
  process.exit(0);
});
