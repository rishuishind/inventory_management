// Database migrations. Each entry runs once, in order; PRAGMA user_version records how many ran.
// Never edit a migration that has shipped - add a new one instead.

export const migrations: string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE items (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    barcode     TEXT    UNIQUE,
    category    TEXT    NOT NULL DEFAULT '',
    unit        TEXT    NOT NULL DEFAULT 'pcs',
    sale_price  INTEGER NOT NULL,
    cost_price  INTEGER NOT NULL DEFAULT 0,
    gst_rate    REAL    NOT NULL DEFAULT 0,
    hsn         TEXT    NOT NULL DEFAULT '',
    stock       REAL    NOT NULL DEFAULT 0,
    low_stock   REAL    NOT NULL DEFAULT 0,
    -- 0 for things made in the canteen (tea, samosa): no stock warnings for them.
    track_stock INTEGER NOT NULL DEFAULT 1,
    quick       INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );
  CREATE INDEX items_name ON items (name COLLATE NOCASE);

  CREATE TABLE bills (
    id                 INTEGER PRIMARY KEY,
    bill_no            TEXT    NOT NULL UNIQUE,
    fy                 TEXT    NOT NULL,
    seq                INTEGER NOT NULL,
    created_at         TEXT    NOT NULL,
    subtotal           INTEGER NOT NULL,
    discount           INTEGER NOT NULL DEFAULT 0,
    taxable            INTEGER NOT NULL,
    cgst               INTEGER NOT NULL DEFAULT 0,
    sgst               INTEGER NOT NULL DEFAULT 0,
    round_off          INTEGER NOT NULL DEFAULT 0,
    total              INTEGER NOT NULL,
    payment_mode       TEXT    NOT NULL,
    tendered           INTEGER,
    gst_mode           TEXT    NOT NULL,
    prices_include_gst INTEGER NOT NULL,
    status             TEXT    NOT NULL DEFAULT 'paid',
    cancelled_at       TEXT,
    UNIQUE (fy, seq)
  );
  CREATE INDEX bills_created ON bills (created_at);

  CREATE TABLE bill_items (
    id          INTEGER PRIMARY KEY,
    bill_id     INTEGER NOT NULL REFERENCES bills (id),
    item_id     INTEGER REFERENCES items (id),
    name        TEXT    NOT NULL,
    barcode     TEXT,
    hsn         TEXT    NOT NULL DEFAULT '',
    unit        TEXT    NOT NULL DEFAULT 'pcs',
    qty         REAL    NOT NULL,
    price       INTEGER NOT NULL,
    cost_price  INTEGER NOT NULL DEFAULT 0,
    amount      INTEGER NOT NULL,
    discount    INTEGER NOT NULL DEFAULT 0,
    gst_rate    REAL    NOT NULL DEFAULT 0,
    taxable     INTEGER NOT NULL,
    tax         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX bill_items_bill ON bill_items (bill_id);
  CREATE INDEX bill_items_item ON bill_items (item_id);

  CREATE TABLE purchases (
    id          INTEGER PRIMARY KEY,
    created_at  TEXT    NOT NULL,
    supplier    TEXT    NOT NULL DEFAULT '',
    invoice_no  TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT '',
    total       INTEGER NOT NULL
  );
  CREATE INDEX purchases_created ON purchases (created_at);

  CREATE TABLE purchase_items (
    id           INTEGER PRIMARY KEY,
    purchase_id  INTEGER NOT NULL REFERENCES purchases (id),
    item_id      INTEGER NOT NULL REFERENCES items (id),
    qty          REAL    NOT NULL,
    cost_price   INTEGER NOT NULL,
    amount       INTEGER NOT NULL
  );
  CREATE INDEX purchase_items_purchase ON purchase_items (purchase_id);
  CREATE INDEX purchase_items_item ON purchase_items (item_id);

  -- Every change to stock, so the stock figure can always be explained.
  CREATE TABLE stock_movements (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items (id),
    created_at  TEXT    NOT NULL,
    change      REAL    NOT NULL,
    balance     REAL    NOT NULL,
    reason      TEXT    NOT NULL,
    ref_id      INTEGER,
    note        TEXT    NOT NULL DEFAULT ''
  );
  CREATE INDEX stock_movements_item ON stock_movements (item_id, id);
  `
]
