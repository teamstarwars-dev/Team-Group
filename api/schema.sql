CREATE TABLE IF NOT EXISTS subscribers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    source VARCHAR(100) DEFAULT 'Team Group',
    ip_address VARCHAR(45),
    country VARCHAR(100),
    city VARCHAR(100),
    user_agent TEXT,
    browser VARCHAR(100),
    os VARCHAR(100),
    device VARCHAR(100),
    page_visited VARCHAR(500),
    referer VARCHAR(500),
    subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    active BOOLEAN DEFAULT TRUE,
    unsubscribed_at TIMESTAMP WITH TIME ZONE,
    unsubscription_reason VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS subscriber_events (
    id SERIAL PRIMARY KEY,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(active);
CREATE INDEX IF NOT EXISTS idx_subscribers_ip ON subscribers(ip_address);
CREATE INDEX IF NOT EXISTS idx_subscribers_date ON subscribers(subscribed_at);
CREATE INDEX IF NOT EXISTS idx_events_subscriber ON subscriber_events(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON subscriber_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_date ON subscriber_events(created_at);
