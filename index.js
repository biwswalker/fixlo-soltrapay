require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const axios = require("axios");

const app = express();
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 20,
  keepAlive: true,
});

// --- 1. API สำหรับส่งคำขอถอนเงิน ---
app.post("/api/withdraw", async (req, res) => {
  const {
    provider,
    amount,
    user_bank_code,
    user_bank_acc_name,
    user_bank_acc_number,
    user_mobile,
  } = req.body;

  try {
    // 1. บันทึกรายการลงฐานข้อมูลเบื้องต้น
    const order_no = `WD-${Date.now()}`;
    await pool.query(
      "INSERT INTO withdraw_transactions (order_no, provider, amount, user_bank_code, user_bank_acc_name, user_bank_acc_number) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        order_no,
        provider,
        amount,
        user_bank_code,
        user_bank_acc_name,
        user_bank_acc_number,
      ],
    );

    // 2. ส่งข้อมูลไปยัง Payment Provider API
    const response = await axios.post(
      `${process.env.API_ENDPOINT}/payment/withhdraw`,
      {
        provider,
        amount,
        user_bank_code,
        user_bank_acc_name,
        user_bank_acc_number,
        user_mobile,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TOKEN}`,
          "merchant-id": process.env.MERCHANT_ID,
        },
      },
    );

    if (response.data.status === 200) {
      // อัปเดต ref_order_no ที่ได้จาก Provider
      await pool.query(
        "UPDATE withdraw_transactions SET ref_order_no = $1 WHERE order_no = $2",
        [response.data.data.ref_order_no, order_no],
      );
      res.json({
        status: "success",
        order_no,
        ref_order_no: response.data.data.ref_order_no,
      });
    } else {
      throw new Error(response.data.message);
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- Middleware สำหรับตรวจสอบ Bearer Token ของ Callback ---
const verifyCallbackToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.CALLBACK_TOKEN}`;

  if (!authHeader || authHeader !== expectedToken) {
    return res
      .status(401)
      .json({ status: 401, message: "Unauthorized: Invalid Token" });
  }
  next();
};

// --- 2. API สำหรับรับ Callback จาก Provider ---
app.post("/api/callback/withdraw", verifyCallbackToken, async (req, res) => {
  const {
    order_no,
    amount,
    real_amount,
    refund_amount,
    payment_datetime,
    status,
    type,
  } = req.body;

  // ตรวจสอบว่าเป็น type withdraw หรือไม่
  if (type !== "withdraw") {
    return res
      .status(400)
      .json({ status: 400, message: "Invalid transaction type" });
  }

  try {
    // อัปเดตข้อมูลและเก็บรายละเอียดจาก Callback ลง Database
    const query = `
            UPDATE withdraw_transactions 
            SET 
                status = $1, 
                real_amount = $2, 
                refund_amount = $3, 
                payment_datetime = $4,
                updated_at = NOW() 
            WHERE order_no = $5 
            RETURNING *;
        `;

    const values = [
      status, // 0=inprogress, 1=success, 2=reject, 3=expired
      real_amount,
      refund_amount,
      payment_datetime,
      order_no,
    ];

    const result = await pool.query(query, values);

    if (result.rowCount > 0) {
      console.log(`[Callback] Order ${order_no} updated successfully.`);
      // ตอบกลับ success ตาม format ทั่วไปของ Provider
      res.status(200).json({ status: 200, message: "success" });
    } else {
      console.warn(`[Callback] Order ${order_no} not found.`);
      res.status(404).json({ status: 404, message: "Order not found" });
    }
  } catch (error) {
    console.error("[Callback Error]:", error);
    res.status(500).json({ status: 500, message: "Internal Server Error" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
