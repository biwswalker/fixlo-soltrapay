require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const path = require("path");

const app = express();
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

// --- Debug: Request Logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`,
    );
    if (req.body && Object.keys(req.body).length > 0) {
      console.log("  Body:", JSON.stringify(req.body, null, 2));
    }
  });
  next();
});

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 20,
  keepAlive: true,
});

// Test Database Connection
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("[Database] Connection Error:", err.stack);
  } else {
    console.log("[Database] Connected successfully at:", res.rows[0].now);
  }
});

// app.use(express.json()); // Duplicate removed
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set("view engine", "ejs");
app.use(
  session({
    secret: "secret-key-for-session",
    resave: false,
    saveUninitialized: true,
  }),
);

// --- Middleware: ตรวจสอบการ Login (Mock) ---
const authMiddleware = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) return res.redirect("/");
  next();
};

// --- Routes: UI ---

app.get("/", (req, res) => {
  res.render("login");
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  // Mock Auth: ยอมรับทุกอย่าง
  res.cookie("auth_token", "mock-jwt-token", { httpOnly: true });
  res.redirect("/withdraw");
});

app.get("/withdraw", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM withdraw_transactions ORDER BY created_at DESC LIMIT 10",
    );

    // ดึง Error หรือ Success message จาก session (ถ้ามี)
    const error = req.session.error;
    const success = req.session.success;
    delete req.session.error; // ใช้เสร็จแล้วลบออกทันที
    delete req.session.success;

    res.render("withdraw", {
      history: result.rows,
      error: error,
      success: success,
    });
  } catch (err) {
    res.status(500).send("Database Error");
  }
});

// --- Routes: API (Action) ---

app.post("/api/withdraw", authMiddleware, async (req, res) => {
  const { amount, bank_code, bank_acc_name, bank_acc_number, mobile } =
    req.body;

  // 1. Validation: ตรวจสอบค่าว่าง
  if (!amount || !bank_code || !bank_acc_name || !bank_acc_number || !mobile) {
    req.session.error = "กรุณากรอกข้อมูลให้ครบทุกช่อง";
    return res.redirect("/withdraw");
  }

  // 2. Validation: จำนวนเงิน
  if (isNaN(amount) || parseFloat(amount) <= 0) {
    req.session.error = "จำนวนเงินต้องเป็นตัวเลขที่มากกว่า 0";
    return res.redirect("/withdraw");
  }

  // 3. Validation: เลขบัญชี (ต้องเป็นตัวเลข)
  if (!/^\d+$/.test(bank_acc_number)) {
    req.session.error = "เลขบัญชีต้องเป็นตัวเลขเท่านั้น";
    return res.redirect("/withdraw");
  }

  // 4. Validation: เบอร์โทรศัพท์ (เช็คตัวเลข 10 หลัก)
  if (!/^\d{10}$/.test(mobile)) {
    req.session.error = "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก";
    return res.redirect("/withdraw");
  }

  try {
    const soltraResponse = await axios.post(
      `${process.env.PAYMENT_API_ENDPOINT}/api/payment/withdraw`,
      {
        provider: "pspay", // หรือตัวแปรที่เลือกจากหน้าบ้าน
        amount: parseFloat(amount),
        user_bank_code: bank_code,
        user_bank_acc_name: bank_acc_name,
        user_bank_acc_number: bank_acc_number,
        user_mobile: mobile,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYMENT_TOKEN}`,
          "merchant-id": process.env.MERCHANT_ID,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(
      "[SoltraPay] API Response:",
      JSON.stringify(soltraResponse.data, null, 2),
    );

    // ตรวจสอบว่า Provider ตอบกลับสำเร็จหรือไม่ (ตามสเปก 200 = success)
    if (soltraResponse.data.status === 200) {
      const order_no = soltraResponse.data.data?.order_no || "";
      const ref_order_no = soltraResponse.data.data?.ref_order_no || "";

      // // 2. บันทึกลงฐานข้อมูล PostgreSQL พร้อม ref_order_no จาก Provider
      await pool.query(
        `INSERT INTO withdraw_transactions
                (order_no, ref_order_no, amount, user_bank_code, user_bank_acc_name, user_bank_acc_number, user_mobile, status, provider)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          order_no,
          ref_order_no,
          amount,
          bank_code,
          bank_acc_name,
          bank_acc_number,
          mobile,
          0,
          "pspay",
        ],
      );

      req.session.success = `ส่งคำขอถอนเงินไปยังระบบ SoltraPay สำเร็จ! (Ref: ${ref_order_no})`;
    } else {
      req.session.error = `SoltraPay Error: ${soltraResponse.data.message}`;
    }

    res.redirect("/withdraw");
  } catch (err) {
    console.error(
      "SoltraPay Connection Error:",
      err.response?.data || err.message,
    );
    req.session.error = "ไม่สามารถเชื่อมต่อกับระบบ SoltraPay ได้";
    res.redirect("/withdraw");
  }
});

// --- 2. API สำหรับรับ Callback จาก Provider ---
app.post("/api/callback/withdraw", async (req, res) => {
  // 1. ตรวจสอบ Security Headers ตามสเปก Postman
  const authHeader = req.headers.authorization;
  const merchantIdHeader = req.headers["merchant-id"];

  const expectedToken = `Bearer ${process.env.CALLBACK_TOKEN}`;
  const expectedMerchantId = process.env.MERCHANT_ID;

  console.log("Callback Headers: ", req.headers);

  if (authHeader !== expectedToken || merchantIdHeader !== expectedMerchantId) {
    console.error("[Callback] Unauthorized Access");
    return res.status(401).json({ status: 401, message: "Unauthorized" });
  }

  const {
    order_no,
    amount,
    real_amount,
    refund_amount,
    payment_datetime,
    status,
    type,
  } = req.body;

  console.log(
    `[Callback] Received for Order: ${order_no}, Status: ${status}, Amount: ${amount}`,
  );

  // 2. ตรวจสอบประเภทรายการ
  if (type !== "withdraw") {
    return res.status(400).json({ status: 400, message: "Invalid type" });
  }

  try {
    // 3. อัปเดตสถานะและข้อมูลการจ่ายเงินจริงลง Database
    // 0 = inprogress, 1 = success, 2 = reject, 3 = expired
    const query = `
            UPDATE withdraw_transactions 
            SET 
                status = $1, 
                real_amount = $2, 
                refund_amount = $3, 
                payment_datetime = $4,
                callback_raw = $5,
                updated_at = NOW() 
            WHERE order_no = $6 
            RETURNING *;
        `;

    const values = [
      status,
      real_amount,
      refund_amount,
      payment_datetime,
      req.rawBody,
      order_no,
    ];
    const result = await pool.query(query, values);

    if (result.rowCount > 0) {
      console.log(`[Callback] Order ${order_no} updated to status ${status}`);
      // 4. ตอบกลับสถานะ 200 OK ให้ Provider ทราบว่าเราได้รับแล้ว
      res.status(200).json({ status: 200, message: "success" });
    } else {
      console.warn(`[Callback] Order ${order_no} not found in our system`);
      res.status(404).json({ status: 404, message: "Order not found" });
    }
  } catch (error) {
    console.error("[Callback Error]:", error);
    res.status(500).json({ status: 500, message: "Internal Server Error" });
  }
});

app.listen(3000, () => {
  console.log("========================================");
  console.log("  Withdraw System Server is running!");
  console.log("  Port: 3000");
  console.log("  Time:", new Date().toLocaleString());
  console.log("========================================");
});
