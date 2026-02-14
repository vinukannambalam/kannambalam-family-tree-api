const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
const nodemailer = require("nodemailer");

const mailer = nodemailer.createTransport({
  host: "smtp.zeptomail.in",
  port: 587,
  secure: false,
  auth: {
    user: process.env.ZEPTO_USER,   // "emailapikey"
    pass: process.env.ZEPTO_PASS
  }
});

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/", (req, res) => {
  res.send("Family Tree API is running 🚀 (auto-deployed)");
});

/* =========================
   AUTH MIDDLEWARE
========================= */
function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ msg: "Invalid token" });
  }
}

/* =========================
   AUTH APIs
========================= */

// Register (using member_id) + notify admins
app.post("/api/auth/register", async (req, res) => {
  try {
    const { full_name, email, phone_no, password, member_id } = req.body;

    if (!full_name || !email || !password || !member_id) {
      return res.status(400).json({ msg: "Missing fields" });
    }

    // 1. Resolve member_id → family_person_id
    const famRes = await pool.query(
      `SELECT id FROM kannambalam_family WHERE member_id = $1`,
      [member_id]
    );

    if (famRes.rowCount === 0) {
      return res.status(400).json({ msg: "Invalid member selected" });
    }

    const familyPersonId = famRes.rows[0].id;

    // 2. Check if already registered
    const exists = await pool.query(
      `SELECT 1 FROM app_users WHERE family_person_id = $1`,
      [familyPersonId]
    );

    if (exists.rowCount > 0) {
      return res.status(409).json({ msg: "This family member is already registered" });
    }

    // 3. Hash password
    const hash = await bcrypt.hash(password, 10);

    // 4. Insert user (pending approval)
    await pool.query(
      `INSERT INTO app_users (full_name, email, phone_no, password_hash, family_person_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [full_name, email, phone_no || null, hash, familyPersonId]
    );

    // 5. Notify all approved admins (non-blocking)
    try {
      const admins = await pool.query(
        `SELECT email FROM app_users WHERE role = 'admin' AND is_approved = true`
      );

      for (const a of admins.rows) {
        await mailer.sendMail({
          from: '"Kannambalam Family Tree" <noreply@kannambalam.com>',
          to: a.email,
          subject: "New user awaiting approval",
          html: `
            <h3>New Registration Pending Approval</h3>
            <p><b>Name:</b> ${full_name}</p>
            <p><b>Email:</b> ${email}</p>
            <p><b>Member ID:</b> ${member_id}</p>
            <p>Please login to the admin panel to approve this user.</p>
          `,
        });
      }
    } catch (mailErr) {
      console.error("Admin email notification failed:", mailErr.message);
      // Do NOT fail registration if email fails
    }

    res.json({ msg: "Registration submitted. Await admin approval." });

  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ msg: "Email or phone already exists" });
    }
    console.error("Register error", e);
    res.status(500).json({ msg: "Registration failed" });
  }
});


// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const r = await pool.query(
      `SELECT 
         u.id, u.full_name, u.password_hash, u.role, u.is_approved, u.family_person_id,
         k.member_id
       FROM app_users u
       LEFT JOIN kannambalam_family k ON k.id = u.family_person_id
       WHERE u.email = $1`,
      [email]
    );

    if (r.rows.length === 0) {
      return res.status(401).json({ msg: "Invalid email or password" });
    }

    const u = r.rows[0];

    if (!u.is_approved) {
      return res.status(403).json({ msg: "Account pending admin approval" });
    }

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ msg: "Invalid email or password" });

    const token = jwt.sign(
      { id: u.id, role: u.role, family_person_id: u.family_person_id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      full_name: u.full_name,
      role: u.role,
      family_person_id: u.family_person_id,
      member_id: u.member_id
    });
  } catch (e) {
    console.error("Login error", e);
    res.status(500).json({ msg: "Login failed" });
  }
});


/* =========================
   ADMIN APIs
========================= */

app.get("/api/admin/pending-users", auth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ msg: "Forbidden" });
  }

  const { rows } = await pool.query(`
    SELECT id, full_name, email, phone_no, family_person_id, eb_created_at
    FROM app_users
    WHERE is_approved = false
    ORDER BY eb_created_at
  `);

  res.json(rows);
});

app.post("/api/admin/approve/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ msg: "Forbidden" });
  }

  await pool.query(
    `UPDATE app_users SET is_approved = true WHERE id = $1`,
    [req.params.id]
  );

  res.json({ msg: "User approved" });
});

// Unregistered family members for registration dropdown
app.get("/api/family/unregistered-members", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        k.id,
        k.member_id,
        k.full_name,
        k.generation
      FROM kannambalam_family k
      WHERE k.id NOT IN (
        SELECT family_person_id 
        FROM app_users 
        WHERE family_person_id IS NOT NULL
      ) AND k.is_alive=true
      ORDER BY k.member_id
    `);

    res.json(rows);
  } catch (e) {
    console.error("Unregistered members error", e);
    res.status(500).json({ msg: "Failed to load members" });
  }
});


/* =========================
   EXISTING FAMILY APIs
========================= */


app.get("/api/family/roots", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id, p.full_name, p.nick_name, p.gender, p.dob, p.dod, p.phone_no, p.alternate_phone,
        p.occupation, p.current_loc, p.marital_status, p.generation, p.is_alive, p.photo_url,
        b1.name_ml AS birth_star, m1.name_ml AS malayalam_month, p.facebook_url, p.instagram_url,
		p.whatsapp_no, p.linkedin_url, p.email,
        s.id AS spouse_id, s.full_name AS spouse_name, s.nick_name AS spouse_nick_name, 
        s.gender AS spouse_gender, s.dob AS spouse_dob, s.dod AS spouse_dod, 
        s.phone_no AS spouse_phone_no, s.alternate_phone AS spouse_alternate_phone, 
        s.occupation AS spouse_occupation, s.current_loc AS spouse_current_loc, 
        s.marital_status AS spouse_marital_status, s.generation AS spouse_generation, 
        s.is_alive AS spouse_is_alive, s.photo_url AS spouse_photo_url, 
        b2.name_ml AS spouse_birth_star, m2.name_ml AS spouse_malayalam_month,
		s.facebook_url AS spouse_facebook_url, s.instagram_url AS spouse_instagram_url, 
		s.whatsapp_no AS spouse_whatsapp_no, s.linkedin_url AS spouse_linkedin_url, s.email AS spouse_email 
      FROM kannambalam_family p
      LEFT JOIN kannambalam_family s ON s.id = p.spouse_id
      LEFT JOIN birth_star b1 ON b1.id = p.birth_star_id
      LEFT JOIN malayalam_month m1 ON m1.id = p.malayalam_month_id
      LEFT JOIN birth_star b2 ON b2.id = s.birth_star_id
      LEFT JOIN malayalam_month m2 ON m2.id = s.malayalam_month_id
      WHERE p.is_root = true
      ORDER BY p.order_id NULLS LAST, p.id
    `);

    res.json(rows);
  } catch (err) {
    console.error("Error in /api/family/roots", err);
    res.status(500).json({ error: "Failed to fetch roots" });
  }
});

// (Keep the rest of your existing routes as-is...)

app.get("/api/family/children/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { rows } = await pool.query(`
      SELECT
        k.id, k.full_name, k.nick_name, k.gender, k.dob, k.dod, k.phone_no, k.alternate_phone, 
		k.occupation, k.current_loc, k.marital_status, k.generation, k.is_alive, k.photo_url, 
		b.name_ml AS birth_star, m.name_ml AS malayalam_month, k.father_id, k.mother_id,
		k.facebook_url, k.instagram_url, k.whatsapp_no, k.linkedin_url, k.email,
      FROM kannambalam_family k
	  LEFT JOIN birth_star b ON b.id=k.birth_star_id
	  LEFT JOIN malayalam_month m ON m.id=k.malayalam_month_id
      WHERE k.father_id = $1 OR k.mother_id = $1
      ORDER BY k.order_id NULLS LAST, k.id
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
        where.push(`k.full_name ILIKE '%' || $${i} || '%'`);
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
          k.full_name ILIKE '%' || $${i} || '%' OR
          b.name_en ILIKE '%' || $${i} || '%' OR
          m.name_en ILIKE '%' || $${i} || '%'
        )`);
        params.push(q);
        i++;
      }
    }

    // Alive filter
    if (alive === "true") {
      where.push(`k.is_alive = true`);
    } else if (alive === "false") {
      where.push(`k.is_alive = false`);
    }

    // Generation filter
    if (Number.isInteger(gen)) {
      where.push(`k.generation = $${i}`);
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
    b.name_ml AS birth_star,
    m.name_ml AS malayalam_month,
	k.facebook_url, 
	k.instagram_url, 
	k.whatsapp_no, 
	k.linkedin_url,
	k.email
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
	p.facebook_url, 
	p.instagram_url, 
	p.whatsapp_no, 
	p.linkedin_url,
	p.email,
    b1.name_ml AS birth_star, 
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
	s.facebook_url AS spouse_facebook_url, 
	s.instagram_url AS spouse_instagram_url, 
	s.whatsapp_no AS spouse_whatsapp_no, 
	s.linkedin_url AS spouse_linkedin_url,
    b2.name_ml AS spouse_birth_star, 
    m2.name_ml AS spouse_malayalam_month,
	s.email AS spouse_email
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
    b.name_ml AS birth_star,
    m.name_ml AS malayalam_month, 
    k.father_id, 
    k.mother_id,
	k.facebook_url, 
	k.instagram_url, 
	k.whatsapp_no, 
	k.linkedin_url,
	k.email
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

