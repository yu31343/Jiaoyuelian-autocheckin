// checkin.js
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// 从环境变量获取敏感信息，对应GitHub Secrets
const USERNAME = process.env.NATPIERCE_USERNAME;
const PASSWORD = process.env.NATPIERCE_PASSWORD;
const LOGIN_URL = 'https://www.natpierce.cn/pc/login/login.html';
const SIGN_URL = 'https://www.natpierce.cn/pc/sign/index.html';

async function autoCheckIn() {
    let browser;
    try {
        // 启动无头浏览器
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ]
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        console.log('Navigating to login page...');
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // ---- 登录流程保持原有逻辑 ----
        await page.waitForSelector('input[placeholder="请输入手机号或邮箱"]', { timeout: 30000 });
        await page.waitForSelector('input[placeholder="请输入密码"]', { timeout: 30000 });
        await page.waitForSelector('div.login_btn', { timeout: 30000 });

        console.log('Typing username...');
        await page.type('input[placeholder="请输入手机号或邮箱"]', USERNAME);

        console.log('Typing password...');
        await page.type('input[placeholder="请输入密码"]', PASSWORD);

        console.log('Clicking login button...');
        await page.click('div.login_btn');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });

        // 跳转签到页
        if (page.url() !== SIGN_URL) {
            console.log(`Navigating to sign-in page: ${SIGN_URL}`);
            await page.goto(SIGN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }

        console.log('Waiting for sign-in button...');
        await page.waitForSelector('#qiandao', { timeout: 30000 });

        console.log('Clicking check-in button...');
        await page.click('#qiandao');

        // 检查服务到期/无需签到信息
        const alreadyCheckedInMessage = await page.evaluate(() => {
            const messageElement = document.querySelector('div.d_hao');
            if (messageElement && messageElement.innerText.includes('服务尚未到期')) {
                return messageElement.innerText;
            }
            return null;
        });

        if (alreadyCheckedInMessage) {
            console.log(`Detected message: "${alreadyCheckedInMessage}". Ending script.`);
            console.log(`CHECKIN_RESULT: ${alreadyCheckedInMessage}`);
            return;
        }

        // 触发 NECaptcha 验证
        console.log('Triggering NECaptcha verification...');
        await page.evaluate(() => {
            if (window.captchaIns) {
                captchaIns.verify();
            }
        });

        // 等待 layer 弹窗提示签到结果
        let statusMessage = '未获取到签到提示';
        try {
            await page.waitForSelector('div.layui-layer-content', { visible: true, timeout: 8000 });
            statusMessage = await page.evaluate(() => {
                const el = document.querySelector('div.layui-layer-content');
                return el ? el.innerText : '未获取到签到提示';
            });
        } catch (e) {
            console.log('Layer message did not appear, checking button text as fallback...');
            const btnText = await page.evaluate(() => {
                const btn = document.querySelector('#qiandao');
                return btn ? btn.innerText : '';
            });
            if (btnText.includes('已签到')) {
                statusMessage = '签到成功 (按钮状态已更新)';
            }
        }

        console.log(`CHECKIN_RESULT: ${statusMessage}`);

    } catch (error) {
        console.error('An error occurred during automation:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

autoCheckIn();
