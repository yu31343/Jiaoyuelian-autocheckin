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

async function solveCaptcha(page) {
    console.log('Attempting to solve captcha...');
    const captchaContainerSelector = '#captcha';
    const sliderHandleSelector = '.yidun_slider'; // This selector might still be valid for the draggable element

    let bgImgUrl = null;
    let jigsawImgUrl = null;

    try {
        // Enable request interception *before* waiting for the captcha container
        // This ensures we don't miss any early requests
        await page.setRequestInterception(true);

        // Set up request listener to capture image URLs
        page.on('request', interceptedRequest => {
            const url = interceptedRequest.url();
            if (url.includes('necaptcha.nosdn.127.net') && (url.endsWith('.jpg') || url.endsWith('.png'))) {
                if (url.endsWith('.jpg') && !bgImgUrl) { // Assuming .jpg is background
                    bgImgUrl = url;
                } else if (url.endsWith('.png') && !jigsawImgUrl) { // Assuming .png is jigsaw
                    jigsawImgUrl = url;
                }
            }
            interceptedRequest.continue();
        });

        // Wait for the captcha container to appear
        await page.waitForSelector(captchaContainerSelector, { timeout: 15000 }); // Increased timeout
        console.log('Captcha container detected.');

        // Explicitly wait for the image responses
        const [bgResponse, jigsawResponse] = await Promise.all([
            page.waitForResponse(response => response.url().includes('necaptcha.nosdn.127.net') && response.url().endsWith('.jpg'), { timeout: 10000 }),
            page.waitForResponse(response => response.url().includes('necaptcha.nosdn.127.net') && response.url().endsWith('.png'), { timeout: 10000 })
        ]);

        bgImgUrl = bgResponse.url();
        jigsawImgUrl = jigsawResponse.url();
        console.log(`Captured background image URL: ${bgImgUrl}`);
        console.log(`Captured jigsaw image URL: ${jigsawImgUrl}`);

        // Disable request interception after capturing URLs
        await page.setRequestInterception(false);

        // Wait for the slider handle to be visible
        await page.waitForSelector(sliderHandleSelector, { timeout: 10000 });
        console.log('Slider handle detected.');

        // Download images
        const bgImgBuffer = await page.goto(bgImgUrl).then(response => response.buffer());
        const jigsawImgBuffer = await page.goto(jigsawImgUrl).then(response => response.buffer());

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
                    // return reject(new Error(stderr));
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
        const endX = startX + offset; // Move by the calculated offset
        const endY = startY; // No vertical movement

        console.log(`Dragging from (${startX}, ${startY}) to (${endX}, ${endY})`);

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY, { steps: 20 }); // Smooth drag
        await page.mouse.up();
        console.log('Slider drag performed.');

        // Wait for captcha to disappear or verification message
        await page.waitForSelector(captchaContainerSelector, { hidden: true, timeout: 10000 })
            .catch(() => console.log('Captcha container did not disappear, might be a retry or success message.'));

        console.log('Captcha solving attempt finished.');
        return true; // Indicate captcha was handled
    } catch (error) {
        console.error('Error solving captcha:', error);
        // Ensure request interception is disabled even on error
        try {
            await page.setRequestInterception(false);
        } catch (interceptionError) {
            console.error('Error disabling request interception:', interceptionError);
        }
        return false; // Indicate captcha solving failed
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
        // 尝试更精确地选择登录按钮，通常登录按钮会有特定的class或者text
        // 这里的选择器需要根据实际HTML来确定，例如：
        // await page.click('button[type="submit"]');
        // await page.click('.login-button'); // 假设登录按钮的class是login-button
        // 根据你截图，登录按钮可能是一个具有文本"登录"的div或button
        // 如果是button，可以是 page.click('button:has-text("登录")');
        // 如果是一个通用的元素，比如带有van-button--normal class，就点击它
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

        // Check if captcha appeared
        const isCaptchaVisible = await page.$('#captcha'); // Check for the captcha container
        if (isCaptchaVisible) {
            console.log('Captcha detected after clicking sign-in button. Attempting to solve...');
            const captchaSolved = await solveCaptcha(page);
            if (!captchaSolved) {
                console.error('Captcha solving failed. Aborting check-in.');
                // Optionally, throw an error or return a specific status
                // For now, let's just log and proceed to get currentStatus, which might be an error message
            }
        } else {
            console.log('No captcha detected.');
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
