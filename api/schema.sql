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

CREATE TABLE IF NOT EXISTS alert_log (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    item_id VARCHAR(100) NOT NULL,
    item_title TEXT,
    item_score DECIMAL(3,1),
    item_severity VARCHAR(20),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    recipients_count INTEGER DEFAULT 0,
    email_id VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_alert_log_type ON alert_log(alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_log_item ON alert_log(item_id);
CREATE INDEX IF NOT EXISTS idx_alert_log_sent ON alert_log(sent_at);

CREATE TABLE IF NOT EXISTS cves (
    id SERIAL PRIMARY KEY,
    cve_id VARCHAR(50) NOT NULL UNIQUE,
    score DECIMAL(3,1) DEFAULT 0,
    severity VARCHAR(20),
    title TEXT,
    description TEXT,
    vendor TEXT,
    product TEXT,
    date DATE,
    "references" JSONB DEFAULT '[]'::jsonb,
    source VARCHAR(50) DEFAULT 'ENISA',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cves_cve_id ON cves(cve_id);
CREATE INDEX IF NOT EXISTS idx_cves_date ON cves(date);
CREATE INDEX IF NOT EXISTS idx_cves_score ON cves(score);
CREATE INDEX IF NOT EXISTS idx_cves_severity ON cves(severity);
CREATE INDEX IF NOT EXISTS idx_cves_vendor ON cves(vendor);
