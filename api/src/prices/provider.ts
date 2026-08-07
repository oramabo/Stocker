export interface Quote {
  ticker: string;
  price: number;
  prevClose: number | null;
}

export interface StockProfile {
  name: string | null;
  currency: string | null;
}

/**
 * Market data source. Everything above this interface is provider-agnostic, so
 * swapping Finnhub for another vendor means adding one file.
 */
export interface PriceProvider {
  readonly name: string;
  /** Latest quote, or null when the provider has no data for the ticker. */
  getQuote(ticker: string): Promise<Quote | null>;
  /** Optional company metadata used to enrich newly created stocks. */
  getProfile?(ticker: string): Promise<StockProfile | null>;
}
