require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/", (req, res) => {
  res.send("Kannambalam Family Tree API – minimal running ✅");
});

app.get("/api/family/roots", async (req, res) => {
  try {
    const { id } = req.query;

    let rows;

    if (id) {
      const result = await pool.query(
        `
        SELECT
          p.id, p.full_name, p.nick_name, p.gender, p.dob, p.dod, p.phone_no,
          p.occupation, p.current_loc, p.generation, p.is_alive, p.photo_url, p.member_id,
          s.id AS spouse_id, s.full_name AS spouse_name, s.photo_url AS spouse_photo_url, 
          s.member_id AS spouse_member_id
        FROM kannambalam_family p
        LEFT JOIN kannambalam_family s ON s.id = p.spouse_id
        WHERE p.id = $1
        `,
        [id]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `
        SELECT
          p.id, p.full_name, p.nick_name, p.gender, p.dob, p.dod, p.phone_no,
          p.occupation, p.current_loc, p.generation, p.is_alive, p.photo_url, p.member_id,
          s.id AS spouse_id, s.full_name AS spouse_name, s.photo_url AS spouse_photo_url, 
          s.member_id AS spouse_member_id
        FROM kannambalam_family p
        LEFT JOIN kannambalam_family s ON s.id = p.spouse_id
        WHERE p.is_root = true
        ORDER BY p.order_id NULLS LAST, p.id
        `
      );
      rows = result.rows;
    }

    res.json(rows);
  } catch (e) {
    console.error("roots error", e);
    res.status(500).json({ error: "Failed to fetch roots" });
  }
});



app.get("/api/family/children/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { rows } = await pool.query(`
      SELECT 
        c.id, c.full_name, c.gender, c.dob, c.dod, c.phone_no, c.alternate_phone,
        c.occupation, c.current_loc, c.marital_status, c.generation, c.order_id,
        c.is_root, c.is_alive, c.nick_name, c.photo_url, c.birth_star_id, c.malayalam_month_id,
        c.spouse_id, c.father_id, c.mother_id, c.member_id,
        c.facebook_url, c.instagram_url, c.whatsapp_no, c.linkedin_url, c.email, c.blood_group,

        bs.name_en AS birth_star_en,
        bs.name_ml AS birth_star_ml,
        mm.name_en AS malayalam_month_en,
        mm.name_ml AS malayalam_month_ml,

        sp.id              AS spouse_id,
        sp.full_name       AS spouse_full_name,
        sp.gender          AS spouse_gender,
        sp.dob             AS spouse_dob,
        sp.dod             AS spouse_dod,
        sp.phone_no        AS spouse_phone_no,
        sp.alternate_phone AS spouse_alternate_phone,
        sp.occupation      AS spouse_occupation,
        sp.current_loc     AS spouse_current_loc,
        sp.marital_status  AS spouse_marital_status,
        sp.generation      AS spouse_generation,
        sp.is_root         AS spouse_is_root,
        sp.is_alive        AS spouse_is_alive,
        sp.nick_name       AS spouse_nick_name,
        sp.photo_url       AS spouse_photo_url,
        sp.birth_star_id   AS spouse_birth_star_id,
        sp.malayalam_month_id AS spouse_malayalam_month_id,
        sp.father_id       AS spouse_father_id,
        sp.mother_id       AS spouse_mother_id,
        sp.member_id       AS spouse_member_id,
        sp.facebook_url    AS spouse_facebook_url,
        sp.instagram_url   AS spouse_instagram_url,
        sp.whatsapp_no     AS spouse_whatsapp_no,
        sp.linkedin_url    AS spouse_linkedin_url,
        sp.email           AS spouse_email,
        sp.blood_group     AS spouse_blood_group,

        bs2.name_en AS spouse_birth_star_en,
        bs2.name_ml AS spouse_birth_star_ml,
        mm2.name_en AS spouse_malayalam_month_en,
        mm2.name_ml AS spouse_malayalam_month_ml

      FROM kannambalam_family c
      LEFT JOIN kannambalam_family sp ON sp.id = c.spouse_id
      LEFT JOIN birth_star bs ON bs.id = c.birth_star_id
      LEFT JOIN malayalam_month mm ON mm.id = c.malayalam_month_id
      LEFT JOIN birth_star bs2 ON bs2.id = sp.birth_star_id
      LEFT JOIN malayalam_month mm2 ON mm2.id = sp.malayalam_month_id

      WHERE c.father_id = $1 OR c.mother_id = $1
      ORDER BY c.order_id NULLS LAST, c.id
    `, [id]);

    res.json(rows);
  } catch (e) {
    console.error("children api error", e);
    res.status(500).json({ error: "Failed to fetch children" });
  }
});


// index.js (Express API)

app.get("/api/family/node/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();

  try {
    const root = await client.query(`
      SELECT 
        p.id, p.full_name, p.gender, p.dob, p.dod, p.phone_no, p.alternate_phone,
        p.occupation, p.current_loc, p.marital_status, p.generation, p.order_id,
        p.is_root, p.is_alive, p.nick_name, p.photo_url, p.birth_star_id, p.malayalam_month_id,
        p.spouse_id, p.father_id, p.mother_id, p.member_id,
        p.facebook_url, p.instagram_url, p.whatsapp_no, p.linkedin_url, p.email, p.blood_group,

        bs.name_en AS birth_star_en,
        bs.name_ml AS birth_star_ml,
        mm.name_en AS malayalam_month_en,
        mm.name_ml AS malayalam_month_ml,

        s.id              AS spouse_id,
        s.full_name       AS spouse_full_name,
        s.gender          AS spouse_gender,
        s.dob             AS spouse_dob,
        s.dod             AS spouse_dod,
        s.phone_no        AS spouse_phone_no,
        s.alternate_phone AS spouse_alternate_phone,
        s.occupation      AS spouse_occupation,
        s.current_loc     AS spouse_current_loc,
        s.marital_status  AS spouse_marital_status,
        s.generation      AS spouse_generation,
        s.order_id        AS spouse_order_id,
        s.is_root         AS spouse_is_root,
        s.is_alive        AS spouse_is_alive,
        s.nick_name       AS spouse_nick_name,
        s.photo_url       AS spouse_photo_url,
        s.birth_star_id   AS spouse_birth_star_id,
        s.malayalam_month_id AS spouse_malayalam_month_id,
        s.father_id       AS spouse_father_id,
        s.mother_id       AS spouse_mother_id,
        s.member_id       AS spouse_member_id,
        s.facebook_url    AS spouse_facebook_url,
        s.instagram_url   AS spouse_instagram_url,
        s.whatsapp_no     AS spouse_whatsapp_no,
        s.linkedin_url    AS spouse_linkedin_url,
        s.email           AS spouse_email,
        s.blood_group     AS spouse_blood_group,

        bs2.name_en AS spouse_birth_star_en,
        bs2.name_ml AS spouse_birth_star_ml,
        mm2.name_en AS spouse_malayalam_month_en,
        mm2.name_ml AS spouse_malayalam_month_ml

      FROM kannambalam_family p
      LEFT JOIN kannambalam_family s ON s.id = p.spouse_id
      LEFT JOIN birth_star bs ON bs.id = p.birth_star_id
      LEFT JOIN malayalam_month mm ON mm.id = p.malayalam_month_id
      LEFT JOIN birth_star bs2 ON bs2.id = s.birth_star_id
      LEFT JOIN malayalam_month mm2 ON mm2.id = s.malayalam_month_id
      WHERE p.id = $1
    `, [id]);

    const children = await client.query(`
      SELECT 
        c.id, c.full_name, c.gender, c.dob, c.dod, c.phone_no, c.alternate_phone,
        c.occupation, c.current_loc, c.marital_status, c.generation, c.order_id,
        c.is_root, c.is_alive, c.nick_name, c.photo_url, c.birth_star_id, c.malayalam_month_id,
        c.spouse_id, c.father_id, c.mother_id, c.member_id,
        c.facebook_url, c.instagram_url, c.whatsapp_no, c.linkedin_url, c.email, c.blood_group,

        bs.name_en AS birth_star_en,
        bs.name_ml AS birth_star_ml,
        mm.name_en AS malayalam_month_en,
        mm.name_ml AS malayalam_month_ml,

        sp.id              AS spouse_id,
        sp.full_name       AS spouse_full_name,
        sp.gender          AS spouse_gender,
        sp.dob             AS spouse_dob,
        sp.dod             AS spouse_dod,
        sp.phone_no        AS spouse_phone_no,
        sp.alternate_phone AS spouse_alternate_phone,
        sp.occupation      AS spouse_occupation,
        sp.current_loc     AS spouse_current_loc,
        sp.marital_status  AS spouse_marital_status,
        sp.generation      AS spouse_generation,
        sp.is_root         AS spouse_is_root,
        sp.is_alive        AS spouse_is_alive,
        sp.nick_name       AS spouse_nick_name,
        sp.photo_url       AS spouse_photo_url,
        sp.birth_star_id   AS spouse_birth_star_id,
        sp.malayalam_month_id AS spouse_malayalam_month_id,
        sp.father_id       AS spouse_father_id,
        sp.mother_id       AS spouse_mother_id,
        sp.member_id       AS spouse_member_id,
        sp.facebook_url    AS spouse_facebook_url,
        sp.instagram_url   AS spouse_instagram_url,
        sp.whatsapp_no     AS spouse_whatsapp_no,
        sp.linkedin_url    AS spouse_linkedin_url,
        sp.email           AS spouse_email,
        sp.blood_group     AS spouse_blood_group,

        bs2.name_en AS spouse_birth_star_en,
        bs2.name_ml AS spouse_birth_star_ml,
        mm2.name_en AS spouse_malayalam_month_en,
        mm2.name_ml AS spouse_malayalam_month_ml

      FROM kannambalam_family c
      LEFT JOIN kannambalam_family sp ON sp.id = c.spouse_id
      LEFT JOIN birth_star bs ON bs.id = c.birth_star_id
      LEFT JOIN malayalam_month mm ON mm.id = c.malayalam_month_id
      LEFT JOIN birth_star bs2 ON bs2.id = sp.birth_star_id
      LEFT JOIN malayalam_month mm2 ON mm2.id = sp.malayalam_month_id
      WHERE c.father_id = $1 OR c.mother_id = $1
      ORDER BY c.order_id NULLS LAST, c.id
    `, [id]);

    res.json({ root: root.rows[0], children: children.rows });
  } catch (e) {
    console.error("node api error", e);
    res.status(500).json({ error: "Failed to fetch node" });
  } finally {
    client.release();
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Minimal API running on port " + PORT);
});
