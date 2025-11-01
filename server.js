/**
 * Tanner.xyz Aggregator Backend
 * * This Node.js server acts as a proxy and data aggregator.
 * It fetches market data from multiple prediction market APIs (Polymarket, Kalshi),
 * normalizes the data into a consistent format, and provides a single endpoint
 * for the React frontend to consume.
 * * This approach is CRITICAL to bypass browser CORS (Cross-Origin Resource Sharing)
 * limitations, as browsers would block the frontend from calling these APIs directly.
 */

const express = require('express');
const https = require('https'); // FIX: Use native Node.js HTTPS module for stable fetching
const http = require('http');   // Also needed for some HTTP traffic/robustness
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS for your frontend
app.use(cors());

// --- API Endpoints ---
const API_ENDPOINTS = {
  // Polymarket: We use HTTPS and accept public data.
  POLYMARKET: 'https://gamma-api.polymarket.com/markets?limit=100&sort_by=volume_24h&order_by=desc&active=true',
  
  // Kalshi: We use the simpler, single-endpoint approach to get all open market data.
  KALSHI_MARKETS: 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=500',

  // Limitless: Temporarily disabled due to API returning HTML/404.
  LIMITLESS: 'https://api.limitless.exchange/api-v1/markets' 
};

// ====================================================================
// NATIVE HTTP/S FETCH HELPER
// ====================================================================

/**
 * Executes a GET request using Node's native HTTP/S module.
 * @param {string} url The URL to fetch.
 * @returns {Promise<any>} The parsed JSON data.
 */
function nativeFetch(url) {
  const isHttps = url.startsWith('https');
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    client.get(url, (res) => {
      let data = '';

      // A chunk of data has been received.
      res.on('data', (chunk) => {
        data += chunk;
      });

      // The whole response has been received.
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            // Log raw response on JSON parsing failure
            console.error(`JSON Parse Error for ${url}: ${e.message}. Status: ${res.statusCode}. Raw data: ${data.substring(0, 500)}...`);
            reject(new Error(`Failed to parse JSON response. Status: ${res.statusCode}`));
          }
        } else {
          // Log raw response on HTTP error
          console.error(`HTTP Error for ${url}: Status: ${res.statusCode}. Raw data: ${data.substring(0, 500)}...`);
          reject(new Error(`HTTP Error Status: ${res.statusCode} for ${url}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Native Fetch Error: ${err.message}`));
    });
  });
}

// ====================================================================
// OPTIMIZATION & DATA HELPERS
// ====================================================================

/**
 * Creates a shortened, optimized title for a market card.
 * @param {string} title The full market title.
 * @returns {string} A truncated title, if necessary.
 */
function optimizeTitle(title) {
  const MAX_LENGTH = 75; // Max characters for a card title
  if (title.length > MAX_LENGTH) {
    return title.substring(0, MAX_LENGTH - 3) + '...';
  }
  return title;
}

/**
 * Intelligently assigns a category based on keywords in the title.
 * @param {string} title The market title.
 * @returns {string} A specific category.
 */
function getAdvancedCategory(title) {
  const lowerTitle = title.toLowerCase();

  // Politics
  if (lowerTitle.includes('trump') || lowerTitle.includes('biden') || lowerTitle.includes('election') || lowerTitle.includes('president') || lowerTitle.includes('mayor')) {
    return 'Politics';
  }
  // Geopolitics (New)
  if (lowerTitle.includes('russia') || lowerTitle.includes('china') || lowerTitle.includes('taiwan') || lowerTitle.includes('gaza') || lowerTitle.includes('war')) {
    return 'Geopolitics';
  }
  // Crypto
  if (lowerTitle.includes('btc') || lowerTitle.includes('bitcoin') || lowerTitle.includes('eth') || lowerTitle.includes('solana') || lowerTitle.includes('crypto')) {
    return 'Crypto';
  }
  // Economics
  if (lowerTitle.includes('fed') || lowerTitle.includes('inflation') || lowerTitle.includes('interest rate') || lowerTitle.includes('gdp') || lowerTitle.includes('cpi')) {
    return 'Economics';
  }
  // Sports
  if (lowerTitle.includes('nba') || lowerTitle.includes('nfl') || lowerTitle.includes('lakers') || lowerTitle.includes('world cup')) {
    return 'Sports';
  }
  // World (New)
  if (lowerTitle.includes('india') || lowerTitle.includes('uk') || lowerTitle.includes('prime minister')) {
    return 'World';
  }
  // Culture (New)
  if (lowerTitle.includes('movie') || lowerTitle.includes('box office') || lowerTitle.includes('taylor swift') || lowerTitle.includes('grammy')) {
    return 'Culture';
  }

  // Fallback
  return 'Other';
}

/**
 * --- NEW: HISTORICAL DATA SIMULATOR ---
 * Generates a realistic (but fake) 7-day price history for an outcome.
 * @param {number} startPrice The starting price (probability) for this outcome.
 * @returns {Array<Object>} An array of data points for the chart.
 */
function generateMarketHistory(startPrice) {
  let history = [];
  let price = startPrice;
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const sevenDaysAgo = now - (7 * 24 * 60 * 60); // 7 days ago
  const dataPoints = 168; // One point per hour for 7 days (7 * 24)
  const timeStep = (7 * 24 * 60 * 60) / dataPoints; // Seconds per step

  for (let i = 0; i < dataPoints; i++) {
    const change = (Math.random() - 0.5) * 0.02; // Small random change
    price += change;
    if (price > 0.99) price = 0.99;
    if (price < 0.01) price = 0.01;
    
    // The format required by Lightweight Charts is: { time: (seconds), value: (price) }
    history.push({ time: sevenDaysAgo + (i * timeStep), value: price });
  }
  
  // Ensure the last data point is the *current* startPrice at the *current* time
  history.push({ time: now, value: startPrice });
  
  return history;
}


// ====================================================================
// DATA FETCHING FUNCTIONS (Using nativeFetch)
// ====================================================================

/**
 * Fetches market data from Polymarket.
 */
async function fetchPolymarketData() {
  try {
    const data = await nativeFetch(API_ENDPOINTS.POLYMARKET);

    // NOTE: Polymarket sometimes returns the array directly, sometimes nested under 'data'.
    const marketArray = Array.isArray(data) ? data : data.data;

    if (!Array.isArray(marketArray)) {
      console.error('Invalid Polymarket response structure. Expected array.', data);
      throw new Error('Invalid Polymarket structure');
    }
    
    // Use .map to transform data, .filter(Boolean) to remove any nulls from failed normalization
    return marketArray.map(normalizePolymarket).filter(Boolean).slice(0, 25);
    
  } catch (error) {
    console.error('Failed to fetch from Polymarket:', error.message);
    return [];
  }
}

/**
 * Fetches market data from Kalshi.
 */
async function fetchKalshiData() {
  try {
    // 1. Fetch all open market and price data in one go
    const marketsData = await nativeFetch(API_ENDPOINTS.KALSHI_MARKETS);

    if (!marketsData || !Array.isArray(marketsData.markets)) {
        console.error('Invalid Kalshi response structure. Expected { markets: [...] }', marketsData);
        throw new Error('Invalid Kalshi structure');
    }

    // 2. Map and normalize, sorting by volume
    return marketsData.markets
      .map(normalizeKalshi) // This will now return the new multi-outcome format
      .filter(Boolean) // Filter out any nulls from failed normalization
      .sort((a, b) => b.volume_24h - a.volume_24h)
      .slice(0, 25);

  } catch (error) {
    console.error('Failed to fetch from Kalshi:', error.message);
    return [];
  }
}

/**
 * Fetches market data from Limitless. (Temporarily disabled)
 */
async function fetchLimitlessData() {
  // NOTE: TEMPORARILY DISABLED
  return []; 
}

// ====================================================================
// DATA NORMALIZATION FUNCTIONS (UPDATED FOR MULTI-OUTCOME)
// ====================================================================

/**
 * --- UPDATED ---
 * Converts a Polymarket market object to our new standard multi-outcome format.
 */
function normalizePolymarket(market) {
  try {
    const fullTitle = market.question;
    const commonData = {
      id: `poly-${market.id}`,
      title: fullTitle,
      shortTitle: optimizeTitle(fullTitle),
      platform: 'Polymarket',
      category: getAdvancedCategory(fullTitle),
      volume_24h: parseFloat(market.volume_24h || market.volume) || 0,
      outcomes: [], // We will populate this next
    };

    // Polymarket's `market.tokens` array contains the outcomes.
    if (market.tokens && market.tokens.length > 0) {
      // This is a Multi-Outcome market (like the election)
      commonData.outcomes = market.tokens.map(token => {
        const price = parseFloat(token.price || 0);
        return {
          name: token.outcome, // e.g., "Zohran Mamdani", "Andrew Cuomo", "Yes", "No"
          price: price,
          history: generateMarketHistory(price), // Generate history for this specific outcome
        };
      });

    } else {
      // This is a simple Yes/No market that isn't using the tokens array
      const yesPrice = parseFloat(market.lastTradePrice || 0.5);
      const noPrice = 1 - yesPrice;
      
      commonData.outcomes = [
        { name: 'Yes', price: yesPrice, history: generateMarketHistory(yesPrice) },
        { name: 'No', price: noPrice, history: generateMarketHistory(noPrice) },
      ];
    }
    
    // Sort outcomes by price, descending (Top outcome first)
    commonData.outcomes.sort((a, b) => b.price - a.price);

    return commonData;

  } catch (err) {
    console.error("Error normalizing Polymarket market:", err.message, market);
    return null;
  }
}

/**
 * --- UPDATED ---
 * Converts a Kalshi event object to our new standard multi-outcome format.
 * Kalshi markets are *always* binary (Yes/No).
 */
function normalizeKalshi(market) {
  try {
    const fullTitle = market.subtitle || market.title;
    
    // Kalshi returns prices in cents (0-100)
    const yesPrice = (market.yes_ask || market.yes_bid || 50) / 100.0;
    const noPrice = (market.no_ask || market.no_bid || 50) / 100.0;
    
    return {
      id: `kalshi-${market.ticker_name || market.ticker}`,
      title: fullTitle,
      shortTitle: optimizeTitle(fullTitle),
      platform: 'Kalshi',
      category: getAdvancedCategory(fullTitle),
      volume_24h: parseFloat(market.volume_24h || market.volume) || 0,
      // Kalshi markets are always Yes/No, so we format them accordingly
      outcomes: [
        { name: 'Yes', price: yesPrice, history: generateMarketHistory(yesPrice) },
        { name: 'No', price: noPrice, history: generateMarketHistory(noPrice) },
      ],
    };
  } catch (err) {
    console.error("Error normalizing Kalshi market:", err.message, market);
    return null;
  }
}

/**
 * Converts a Limitless market object to our standard format. (DISABLED)
 */
function normalizeLimitless(market) {
  // This function is currently disabled in fetchLimitlessData()
  return null;
}

// ====================================================================
// THE MAIN API ENDPOINT
// ====================================================================

app.get('/api/markets', async (req, res) => {
  console.log('Received request for /api/markets');

  // Fetch from all platforms in parallel
  const results = await Promise.allSettled([
    fetchPolymarketData(),
    fetchKalshiData(),
    fetchLimitlessData(), // Currently disabled, returns []
  ]);

  // Combine all successful results
  const allNormalizedMarkets = results
    .filter(result => result.status === 'fulfilled') // Only take successful fetches
    .flatMap(result => result.value); // Flatten the arrays [[...], [...]] into [...]
  
  // Sort all markets from all platforms by 24h volume
  const sortedMarkets = allNormalizedMarkets.sort((a, b) => b.volume_24h - a.volume_24h);

  console.log(`Returning ${sortedMarkets.length} normalized markets.`);
  res.json(sortedMarkets);
});

// ====================================================================
// START THE SERVER
// ====================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Aggregator backend listening on port ${PORT}`);
});
