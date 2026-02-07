const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/", (req, res) => {
  res.send("Family Tree API is running");
});

app.get("/api/family/roots", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.full_name,
        p.nick_name,
        p.gender,
        p.dob,
        p.dod,
        p.phone_no,
        p.alternate_phone,
        p.occupation,
        p.current_loc,
        p.marital_status,
        p.generation,
        p.is_alive,
        p.photo_url,
        p.birth_star,
        p.malayalam_month,

        s.id AS spouse_id,
        s.full_name AS spouse_name,
        s.photo_url AS spouse_photo_url

      FROM kannambalam_family p
      LEFT JOIN kannambalam_family s 
        ON s.id = p.spouse_id
      WHERE p.is_root = true
      ORDER BY p.order_id NULLS LAST, p.id
    `);

    res.json(rows);
  } catch (err) {
    console.error("Error in /api/family/roots", err);
    res.status(500).json({ error: "Failed to fetch roots" });
  }
});

app.get("/api/family/children/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { rows } = await pool.query(`
      SELECT
        id,
        full_name,
        nick_name,
        gender,
        dob,
        dod,
        phone_no,
        alternate_phone,
        occupation,
        current_loc,
        marital_status,
        generation,
        is_alive,
        photo_url,
        birth_star,
        malayalam_month,
        father_id,
        mother_id
      FROM kannambalam_family
      WHERE father_id = $1
         OR mother_id = $1
      ORDER BY order_id NULLS LAST, id
    `, [id]);

    res.json(rows);
  } catch (err) {
    console.error("Error in /api/family/children/:id", err);
    res.status(500).json({ error: "Failed to fetch children" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
