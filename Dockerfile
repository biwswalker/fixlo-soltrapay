# ใช้ Node.js LTS
FROM node:24-slim

# สร้าง Working directory
WORKDIR /usr/src/app

# คัดลอก package.json เพื่อติดตั้ง dependencies
COPY package*.json ./

# ติดตั้ง dependencies ทั้งหมด (รวม ejs, session, cookie-parser ที่เพิ่มมาใหม่)
RUN npm install --only=production

# คัดลอกไฟล์ทั้งหมด (รวมโฟลเดอร์ views, public และไฟล์ .js)
COPY . .

# กำหนด Port
EXPOSE 3000

# รันแอปพลิเคชัน
CMD [ "node", "index.js" ]