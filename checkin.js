// checkin.js
const puppeteer = require('puppeteer');
const fs = require('fs').promises; // For file operations
const path = require('path'); // For path manipulation
const { exec } = require('child_process'); // For running Python script

// 从环境变量获取敏感信息，对应GitHub Secrets
const USERNAME = process.env.NATPIERCE_USERNAME;
const PASSWORD = process.env.NATPIERCE_PASSWORD;
const LOGIN_URL = 'https://www.natpierce.cn/pc/login/login.html'; // 明确登录页
const SIGN_URL = 'https://www.natpierce.cn/pc/sign/index.html';   // 签到页

async function solveCaptcha(page, bgImgUrl, jigsawImgUrl) {
    console.log('Attempting to solve captcha with provided image URLs...');
    const captchaContainerSelector = '#captcha';
    const sliderHandleSelector = '.yidun_slider';

    try {
        // URLs are now passed as arguments, so we don't need to intercept requests here.

        // Wait for the slider handle to be visible
        await page.waitForSelector(sliderHandleSelector, { timeout: 10000 });
        console.log('Slider handle detected.');

        // Download images using the provided URLs
        console.log(`Using background image URL: ${bgImgUrl}`);
        console.log(`Using jigsaw image URL: ${jigsawImgUrl}`);

        // It's better to create a new page for downloading to not interfere with the current page state
        const newPage = await page.browser().newPage();
        const bgImgBuffer = await newPage.goto(bgImgUrl).then(response => response.buffer());
        const jigsawImgBuffer = await newPage.goto(jigsawImgUrl).then(response => response.buffer());
        await newPage.close();

        const bgImgPath = path.join(__dirname, 'captcha_bg.png');
        const jigsawImgPath = path.join(__dirname, 'captcha_jigsaw.png');

        await fs.writeFile(bgImgPath, bgImgBuffer);
        await fs.writeFile(jigsawImgPath, jigsawImgBuffer);
        console.log('Captcha images saved.');

        // Call Python script to solve captcha
        const solveResult = await new Promise((resolve, reject) => {
            exec(`python solve_captcha.py "${bgImgPath}" "${jigsawImgPath}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    return reject(error);
                }
                if (stderr) {
                    console.error(`stderr: ${stderr}`);
                }
                resolve(stdout.trim());
            });
        });

        const offset = parseFloat(solveResult);
        if (isNaN(offset)) {
            throw new Error(`Failed to get valid offset from Python script: ${solveResult}`);
        }
        console.log(`Calculated offset: ${offset}`);

        // Perform slider drag
        const sliderHandle = await page.$(sliderHandleSelector);
        const sliderBoundingBox = await sliderHandle.boundingBox();

        if (!sliderBoundingBox) {
            throw new Error('Could not get bounding box for slider handle.');
        }

        const startX = sliderBoundingBox.x + sliderBoundingBox.width / 2;
        const startY = sliderBoundingBox.y + sliderBoundingBox.height / 2;
        const endX = startX + offset;
        const endY = startY;

        console.log(`Dragging from (${startX}, ${startY}) to (${endX}, ${endY})`);

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY, { steps: 20 });
        await page.mouse.up();
        console.log('Slider drag performed.');

        await page.waitForSelector(captchaContainerSelector, { hidden: true, timeout: 10000 })
            .catch(() => console.log('Captcha container did not disappear, might be a retry or success message.'));

        console.log('Captcha solving attempt finished.');
        return true;
    } catch (error) {
        console.error('Error solving captcha:', error);
        return false;
    }
}


async function autoCheckIn() {
    let browser;
    try {
        // 启动无头浏览器
        browser = await puppeteer.launch({
            headless: true, // 在GitHub Actions中必须是true
            args: [
                '--no-sandbox', // GitHub Actions中需要这个参数
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ]
        });
        const page = await browser.newPage();

        // 设置User-Agent，模拟正常浏览器访问
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        console.log('Navigating to login page...');
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); // 等待DOM加载完成

        // 确保页面加载完成，防止元素找不到
        await page.waitForSelector('input[placeholder="请输入手机号或邮箱"]', { timeout: 30000 });
        await page.waitForSelector('input[placeholder="请输入密码"]', { timeout: 30000 });
        await page.waitForSelector('div.login_btn', { timeout: 30000 }); // 根据用户提供的信息更新登录按钮选择器

        console.log('Typing username...');
        await page.type('input[placeholder="请输入手机号或邮箱"]', USERNAME);

        console.log('Typing password...');
        await page.type('input[placeholder="请输入密码"]', PASSWORD);

        // 点击登录按钮
        console.log('Clicking login button...');
        await page.click('div.login_btn'); // 根据用户提供的信息更新登录按钮选择器

        console.log('Waiting for navigation after login...');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }); // 等待登录后的页面跳转

        // 验证是否已跳转到签到页面
        if (page.url() !== SIGN_URL) {
            console.log(`Successfully logged in, now navigating to sign-in page: ${SIGN_URL}`);
            await page.goto(SIGN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } else {
            console.log('Already on sign-in page after login.');
        }

        // 再次等待页面元素加载，特别是签到按钮
        console.log('Waiting for sign-in button...');
        const checkinButtonSelector = '#qiandao'; // 根据用户提供的信息更新签到按钮选择器
        await page.waitForSelector(checkinButtonSelector, { timeout: 30000 });

        console.log('Clicking check-in button...');
        await page.click(checkinButtonSelector);

        // Check if captcha appeared and handle it
        try {
            await page.waitForSelector('#captcha', { visible: true, timeout: 10000 });
            console.log('Captcha container detected.');

            // Now that the captcha is visible, wait for the image network responses
            const [bgResponse, jigsawResponse] = await Promise.all([
                page.waitForResponse(response => response.url().includes('necaptcha.nosdn.127.net') && response.url().endsWith('.jpg'), { timeout: 15000 }),
                page.waitForResponse(response => response.url().includes('necaptcha.nosdn.127.net') && response.url().endsWith('.png'), { timeout: 15000 })
            ]);

            const bgImgUrl = bgResponse.url();
            const jigsawImgUrl = jigsawResponse.url();
            
            if (!bgImgUrl || !jigsawImgUrl) {
                throw new Error('Failed to capture one or both captcha image URLs.');
            }

            const captchaSolved = await solveCaptcha(page, bgImgUrl, jigsawImgUrl);
            if (!captchaSolved) {
                console.error('Captcha solving failed. Aborting check-in.');
            }

        } catch (error) {
            // This will catch if the captcha selector times out (i.e., no captcha)
            // or if waiting for images times out.
            console.log('No captcha detected or an error occurred during captcha handling.');
        }

        // 签到后通常会有弹窗或页面变化，等待一下
        await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒，观察弹窗或提示
        console.log('Check-in button clicked (or captcha solved).');

        // 再次检查是否有“服务尚未到期，无需签到”的提示
        const currentStatus = await page.evaluate(() => {
            const messageElement = document.querySelector('div.layui-layer-content'); // 根据用户提供的信息更新提示文本选择器
            return messageElement ? messageElement.innerText : 'No toast message found.';
        });
        console.log(`Check-in result/toast: ${currentStatus}`);

        console.log(`CHECKIN_RESULT: ${currentStatus}`); // Output the check-in result for the workflow

    } catch (error) {
        console.error('An error occurred during automation:', error);
        // If an error occurs, print the error but do not exit with an error code
        // This allows the push notification script to still run with a potential error message
        // process.exit(1); // Do not exit with error code here, let the workflow continue
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

autoCheckIn();
