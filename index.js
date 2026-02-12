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
  res.send("Family Tree API is running 🚀 (auto-deployed)");
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
        b1.name_en AS birth_star, 
        m1.name_en AS malayalam_month, 
        s.id AS spouse_id, 
        s.full_name AS spouse_name, 
        s.nick_name AS spouse_nick_name, 
        s.gender AS spouse_gender, 
        s.dob AS spouse_dob, 
        s.dod AS spouse_dod, 
        s.phone_no AS spouse_phone_no, 
        s.alternate_phone AS spouse_alternate_phone, 
        s.occupation AS spouse_occupation, 
        s.current_loc AS spouse_current_loc, 
        s.marital_status AS spouse_marital_status, 
        s.generation AS spouse_generation, 
        s.is_alive AS spouse_is_alive,
        s.photo_url AS spouse_photo_url, 
        b2.name_en AS spouse_birth_star, 
        m2.name_en AS spouse_malayalam_month
      FROM 
		kannambalam_family p
      LEFT JOIN
		kannambalam_family s ON s.id = p.spouse_id
      LEFT JOIN
		birth_star b1 ON b1.id = p.birth_star_id
      LEFT JOIN
		malayalam_month m1 ON m1.id = p.malayalam_month_id
      LEFT JOIN
		birth_star b2 ON b2.id = s.birth_star_id
      LEFT JOIN
		malayalam_month m2 ON m2.id = s.malayalam_month_id
      WHERE
		p.is_root = true
      ORDER BY
		p.order_id NULLS LAST, p.id
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
        k.id, 
		k.full_name, 
		k.nick_name, 
		k.gender, 
		k.dob, 
		k.dod, 
		k.phone_no, 
		k.alternate_phone, 
		k.occupation,
        k.current_loc, 
		k.marital_status, 
		k.generation, 
		k.is_alive, 
		k.photo_url, 
		b.name_en AS birth_star,
        m.name_en AS malayalam_month, 
		k.father_id, 
		k.mother_id 
      FROM
		kannambalam_family k
	  LEFT JOIN
		birth_star b ON b.id=k.birth_star_id
	  LEFT JOIN
		malayalam_month m ON m.id=k.malayalam_month_id
      WHERE
		k.father_id = $1 OR k.mother_id = $1
      ORDER BY
		k.order_id NULLS LAST, k.id
    `, [id]);

    res.json(rows);
  } catch (err) {
    console.error("Error in /api/family/children/:id", err);
    res.status(500).json({ error: "Failed to fetch children" });
  }
});

app.get("/api/family/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const field = (req.query.field || "all").toLowerCase();
    const alive = (req.query.alive || "all").toLowerCase();
    const gen = req.query.gen ? parseInt(req.query.gen, 10) : null;

    let where = [];
    let params = [];
    let i = 1;

    // Text search
    if (q) {
      if (field === "name") {
        where.push(`full_name ILIKE '%' || $${i} || '%'`);
        params.push(q);
        i++;
      } else if (field === "star") {
        where.push(`b.name_en ILIKE '%' || $${i} || '%'`);
        params.push(q);
        i++;
      } else if (field === "month") {
        where.push(`m.name_en ILIKE '%' || $${i} || '%'`);
        params.push(q);
        i++;
      } else {
        where.push(`(
          full_name ILIKE '%' || $${i} || '%' OR
          b.name_en ILIKE '%' || $${i} || '%' OR
          m.name_en ILIKE '%' || $${i} || '%'
        )`);
        params.push(q);
        i++;
      }
    }

    // Alive filter
    if (alive === "true") {
      where.push(`is_alive = true`);
    } else if (alive === "false") {
      where.push(`is_alive = false`);
    }

    // Generation filter
    if (Number.isInteger(gen)) {
      where.push(`generation = $${i}`);
      params.push(gen);
      i++;
    }

    // If no filters at all → return empty (prevent full table scan)
    if (!q && alive === "all" && !Number.isInteger(gen)) {
      return res.json([]);
    }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const { rows } = await pool.query(`
  SELECT
    k.id, 
    k.full_name, 
    k.nick_name, 
    k.gender, 
    k.dob, 
    k.dod, 
    k.phone_no, 
    k.alternate_phone, 
    k.occupation,
    k.current_loc, 
    k.marital_status, 
    k.generation, 
    k.is_alive, 
    k.photo_url, 
    b.name_en AS birth_star,
    m.name_ml AS malayalam_month
  FROM
	kannambalam_family k
  LEFT JOIN
	birth_star b ON b.id = k.birth_star_id
  LEFT JOIN
	malayalam_month m ON m.id = k.malayalam_month_id
  ${whereSql}
  ORDER BY
	k.full_name
  LIMIT 250
`, params);

    res.json(rows);
  } catch (err) {
    console.error("Error in /api/family/search", err);
    res.status(500).json({ error: "Search failed" });
  }
});


app.get("/api/family/family", async (req, res) => {
  try {
    const personId = parseInt(req.query.person_id, 10);

    if (!personId) {
      return res.status(400).json({ error: "person_id is required" });
    }

    const personResult = await pool.query(`
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
    b1.name_en AS birth_star, 
    m1.name_ml AS malayalam_month, 
    s.id AS spouse_id, 
    s.full_name AS spouse_name, 
    s.nick_name AS spouse_nick_name, 
    s.gender AS spouse_gender, 
    s.dob AS spouse_dob, 
    s.dod AS spouse_dod, 
    s.phone_no AS spouse_phone_no,  
    s.alternate_phone AS spouse_alternate_phone, 
    s.occupation AS spouse_occupation, 
    s.current_loc AS spouse_current_loc, 
    s.marital_status AS spouse_marital_status, 
    s.generation AS spouse_generation, 
    s.is_alive AS spouse_is_alive, 
    s.photo_url AS spouse_photo_url, 
    b2.name_en AS spouse_birth_star, 
    m2.name_ml AS spouse_malayalam_month
  FROM
	kannambalam_family p
  LEFT JOIN
	kannambalam_family s ON s.id = p.spouse_id
  LEFT JOIN
	birth_star b1 ON b1.id = p.birth_star_id
  LEFT JOIN
	malayalam_month m1 ON m1.id = p.malayalam_month_id
  LEFT JOIN
	birth_star b2 ON b2.id = s.birth_star_id
  LEFT JOIN
	malayalam_month m2 ON m2.id = s.malayalam_month_id
  WHERE
	p.id = $1
  LIMIT 1
`, [personId]);

    const person = personResult.rows[0] || null;

    if (!person) {
      return res.json({ person: null, children: [] });
    }

    const childrenResult = await pool.query(`
  SELECT
    k.id, 
    k.full_name, 
    k.nick_name, 
    k.gender, 
    k.dob, 
    k.dod, 
    k.phone_no, 
    k.alternate_phone, 
    k.occupation,
    k.current_loc, 
    k.marital_status, 
    k.generation, 
    k.is_alive, 
    k.photo_url, 
    b.name_en AS birth_star,
    m.name_ml AS malayalam_month, 
    k.father_id, 
    k.mother_id 
  FROM kannambalam_family k
  LEFT JOIN
	birth_star b ON b.id = k.birth_star_id
  LEFT JOIN
	malayalam_month m ON m.id = k.malayalam_month_id
  WHERE 
    k.father_id = $1 OR k.mother_id = $1
  ORDER BY 
	k.order_id NULLS LAST, k.id
`, [personId]);


    const children = (childrenResult.rows || []).filter(
      c => c.id !== person.spouse_id
    );

    res.json({ person, children });
  } catch (err) {
    console.error("Error in /api/family/family", err);
    res.status(500).json({ error: "Failed to fetch family" });
  }
});

app.get("/api/family/lineage/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { rows } = await pool.query(`
      WITH RECURSIVE ancestors AS (
        SELECT 
			id, full_name, father_id, mother_id
        FROM
			kannambalam_family
        WHERE id = $1

        UNION ALL

        SELECT
			p.id, p.full_name, p.father_id, p.mother_id
        FROM
			kannambalam_family p
        JOIN
			ancestors a ON p.id = a.father_id OR p.id = a.mother_id
      )
      SELECT * FROM ancestors;
    `, [id]);

    res.json(rows.reverse()); // root → person
  } catch (e) {
    console.error("Lineage error", e);
    res.status(500).json({ error: "Failed to fetch lineage" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
