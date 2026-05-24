export const DEFAULT_TV_SYMBOLS = [
  { s: 'AMEX:GLD', d: 'Gold ETF' },
  { s: 'NASDAQ:NVDA', d: 'NVIDIA' },
  { s: 'NASDAQ:IBIT', d: 'Bitcoin ETF' },
  { s: 'NASDAQ:MSFT', d: 'Microsoft' },
  { s: 'NASDAQ:GOOG', d: 'Alphabet' },
  { s: 'AMEX:VOO', d: 'S&P 500 ETF' },
  { s: 'NASDAQ:BOTZ', d: 'Robotics & AI ETF' },
  { s: 'NASDAQ:SMCI', d: 'Super Micro' },
  { s: 'NASDAQ:AAPL', d: 'Apple' },
  { s: 'NASDAQ:INTC', d: 'Intel' },
  { s: 'NASDAQ:AMD', d: 'AMD' },
];

export const MARKETS_OVERVIEW_LIST = {
  id: 'wp-markets-overview',
  name: 'March\u00e9s',
  symbols: [
    { s: 'SP:SPX', y: '^GSPC', d: 'S&P 500' },
    { s: 'DJ:DJI', y: '^DJI', d: 'Dow Jones' },
    { s: 'NASDAQ:IXIC', y: '^IXIC', d: 'NASDAQ Composite' },
    { s: 'TVC:NI225', y: '^N225', d: 'Nikkei 225' },
    { s: 'TVC:UKX', y: '^FTSE', d: 'FTSE 100' },
    { s: 'XETR:DAX', y: '^GDAXI', d: 'DAX' },
    { s: 'EURONEXT:PX1', y: '^FCHI', d: 'CAC 40' },
    { s: 'TSX:TSX', y: '^GSPTSE', d: 'S&P/TSX Composite' },
  ],
};

const TV_HEATMAP_HTML = `<!DOCTYPE html>
<html style="margin:0;padding:0;width:100%;height:100%;background:#0a0a0c">
<head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:#0a0a0c}
  #wrap{position:absolute;inset:0;overflow:hidden}
  #scaled{position:absolute;top:0;left:0;width:768px;height:1024px;transform-origin:0 0}
  .tradingview-widget-container,.tradingview-widget-container__widget{width:768px;height:1024px}
</style></head>
<body>
<div id="wrap">
  <div id="scaled">
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js" async>
      {
        "dataSource": "SPX500",
        "blockColor": "change",
        "blockSize": "market_cap_basic",
        "grouping": "sector",
        "isTransparent": true,
        "locale": "en",
        "colorTheme": "dark",
        "width": "100%",
        "height": "100%",
        "hasTopBar": false,
        "isDataSetEnabled": false,
        "isZoomEnabled": true,
        "hasSymbolTooltip": true
      }
      </script>
    </div>
  </div>
</div>
<script>
  function fit() {
    var wrap = document.getElementById('wrap');
    var scaled = document.getElementById('scaled');
    if (!wrap || !scaled) return;
    var s = Math.min(wrap.clientWidth / 768, wrap.clientHeight / 1024);
    var tx = (wrap.clientWidth  - 768 * s) / 2;
    var ty = (wrap.clientHeight - 1024 * s) / 2;
    scaled.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
  }
  fit();
  window.addEventListener('resize', fit);
  new ResizeObserver(fit).observe(document.getElementById('wrap'));
</script>
</body>
</html>`;

export const HEATMAP_TAB = {
  id: 'wp-heatmap',
  name: 'Heatmap',
  kind: 'heatmap',
  url: 'data:text/html;charset=utf-8,' + encodeURIComponent(TV_HEATMAP_HTML),
};
