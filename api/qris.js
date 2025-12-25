const express = require('express');
const cors = require('cors');
const axios = require('axios');
const qs = require('qs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Konfigurasi
const ADMIN_FEE = 50; // Biaya admin 50 rupiah
const MERCHANT_QRIS = '00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214251114147015770303UMI51440014ID.CO.QRIS.WWW0215ID20254541656840303UMI5204481253033605802ID5921Sazyfa Cell Ok26924716015TAPANULI TENGAH61052256262070703A0163045CF4';
const ORDERKUOTA_PROXY = 'https://orderkuota-proxy.vercel.app/api';

// Helper: Tambahkan biaya admin ke QRIS string
function addAdminFeeToQRIS(qrisString, adminFee) {
    try {
        // QRIS format: 54 adalah tag untuk amount
        const amountTag = '54';
        const tagIndex = qrisString.indexOf(amountTag);
        
        if (tagIndex !== -1) {
            const lengthIndex = tagIndex + 2;
            const lengthStr = qrisString.substr(lengthIndex, 2);
            const length = parseInt(lengthStr);
            
            if (!isNaN(length) && length > 0) {
                const amountStart = lengthIndex + 2;
                const amountEnd = amountStart + length;
                const currentAmountStr = qrisString.substr(amountStart, length);
                const currentAmount = parseInt(currentAmountStr);
                
                if (!isNaN(currentAmount)) {
                    const newAmount = currentAmount + adminFee;
                    const newAmountStr = newAmount.toString();
                    const newLength = newAmountStr.length.toString().padStart(2, '0');
                    
                    // Replace amount section
                    const newQRIS = qrisString.substring(0, lengthIndex) + 
                                   newLength + 
                                   newAmountStr + 
                                   qrisString.substring(amountEnd);
                    
                    console.log(`QRIS Modified: ${currentAmount} -> ${newAmount}`);
                    return newQRIS;
                }
            }
        }
        return qrisString;
    } catch (error) {
        console.error('Error modifying QRIS:', error);
        return qrisString;
    }
}

// Endpoint: Health Check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        data: {
            service: 'QRIS Generator Pro',
            version: '2.0',
            admin_fee: ADMIN_FEE,
            status: 'active'
        }
    });
});

// Endpoint: Login dengan auto-OTP
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_CREDENTIALS',
                    message: 'Username dan password diperlukan'
                }
            });
        }

        // Step 1: Request OTP
        const otpResponse = await axios.post(
            `${ORDERKUOTA_PROXY}/auth/otp`,
            { username, password },
            { timeout: 10000 }
        );

        if (!otpResponse.data?.success) {
            return res.status(400).json(otpResponse.data);
        }

        res.json({
            success: true,
            data: {
                otp_sent: true,
                otp_target: otpResponse.data.data.results.otp_value
            }
        });

    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'LOGIN_FAILED',
                message: error.message
            }
        });
    }
});

// Endpoint: Verify OTP dan get token
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { username, otp } = req.body;
        
        if (!username || !otp) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_PARAMS',
                    message: 'Username dan OTP diperlukan'
                }
            });
        }

        const tokenResponse = await axios.post(
            `${ORDERKUOTA_PROXY}/auth/token`,
            { username, otp },
            { timeout: 10000 }
        );

        if (!tokenResponse.data?.success) {
            return res.status(400).json(tokenResponse.data);
        }

        res.json(tokenResponse.data);

    } catch (error) {
        console.error('Verify error:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'VERIFICATION_FAILED',
                message: error.message
            }
        });
    }
});

// Endpoint: Generate QRIS dengan biaya admin
app.post('/api/qris/generate', async (req, res) => {
    try {
        const { username, token, amount, qris_static } = req.body;
        
        if (!username || !token || !amount) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_PARAMS',
                    message: 'Username, token, dan amount diperlukan'
                }
            });
        }

        // Panggil OrderKuota Proxy API
        const proxyResponse = await axios.post(
            `${ORDERKUOTA_PROXY}/qris/generate`,
            {
                username,
                token,
                amount: parseInt(amount),
                qris_static: qris_static || MERCHANT_QRIS
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );

        if (!proxyResponse.data?.success) {
            return res.status(400).json(proxyResponse.data);
        }

        const proxyData = proxyResponse.data.data;
        
        // Tambahkan biaya admin ke QRIS string
        const qrisWithFee = addAdminFeeToQRIS(proxyData.qris_string, ADMIN_FEE);
        
        // Response dengan biaya admin
        const responseData = {
            ...proxyData,
            qris_string: qrisWithFee,
            admin_fee: ADMIN_FEE,
            final_amount: parseInt(amount) + ADMIN_FEE,
            note: `Sudah termasuk biaya admin Rp ${ADMIN_FEE}`
        };

        res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Generate QRIS error:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'GENERATION_FAILED',
                message: error.message
            }
        });
    }
});

// Endpoint: Cek status pembayaran
app.post('/api/qris/check', async (req, res) => {
    try {
        const { username, token, transaction_id } = req.body;
        
        if (!username || !token || !transaction_id) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_PARAMS',
                    message: 'Username, token, dan transaction_id diperlukan'
                }
            });
        }

        const proxyResponse = await axios.post(
            `${ORDERKUOTA_PROXY}/qris/check`,
            { username, token, transaction_id },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );

        res.json(proxyResponse.data);

    } catch (error) {
        console.error('Check status error:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'CHECK_FAILED',
                message: error.message
            }
        });
    }
});

// Endpoint: Cek saldo
app.post('/api/account/balance', async (req, res) => {
    try {
        const { username, token } = req.body;
        
        const proxyResponse = await axios.post(
            `${ORDERKUOTA_PROXY}/account/balance`,
            { username, token },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );

        res.json(proxyResponse.data);

    } catch (error) {
        console.error('Balance error:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'BALANCE_FAILED',
                message: error.message
            }
        });
    }
});

// Endpoint: Webhook untuk notifikasi (jika perlu)
app.post('/api/webhook/payment', (req, res) => {
    console.log('Payment webhook received:', req.body);
    
    // TODO: Implementasi database atau notifikasi Telegram
    res.json({ 
        success: true, 
        message: 'Webhook received',
        timestamp: new Date().toISOString()
    });
});

// Endpoint: Get QRIS static
app.get('/api/qris/static', (req, res) => {
    res.json({
        success: true,
        data: {
            qris_static: MERCHANT_QRIS,
            merchant_name: 'Sazyfa Cell Ok',
            location: 'TAPANULI TENGAH',
            admin_fee: ADMIN_FEE
        }
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/../index.html');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: {
            code: 'SERVER_ERROR',
            message: 'Internal server error'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: 'Endpoint tidak ditemukan'
        }
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`💰 Admin fee: Rp ${ADMIN_FEE} per transaction`);
        console.log(`🌐 Frontend: http://localhost:${PORT}`);
    });
}

module.exports = app;
