// checkin.js
const puppeteer = require('puppeteer');

// 从环境变量获取敏感信息，对应GitHub Secrets
const USERNAME = process.env.NATPIERCE_USERNAME;
const PASSWORD = process.env.NATPIERCE_PASSWORD;
const LOGIN_URL = 'https://www.natpierce.cn/pc/login/login.html'; // 明确登录页
const SIGN_URL = 'https://www.natpierce.cn/pc/sign/index.html';   // 签到页

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
        // 这是最关键的步骤，需要精确的签到按钮选择器
        // 根据你之前的描述“蓝色底色，白色‘签到’文字的按钮”，它可能是：
        // 1. 一个带有特定class的button： `button.some-blue-button-class`
        // 2. 一个包含“签到”文本的元素： `button:has-text("签到")` 或 `div.some-class:has-text("签到")`
        // 3. 一个具有特定id的元素： `#checkin-button`
        // 你需要在登录后的签到页面上检查HTML结构来获取最准确的选择器。
        // 这里我假设它是一个包含"签到"文本的按钮或者带有特定class的按钮
        const checkinButtonSelector = '#qiandao'; // 根据用户提供的信息更新签到按钮选择器
        await page.waitForSelector(checkinButtonSelector, { timeout: 30000 });

        // 检查签到按钮是否可点击（例如，是否被禁用）
        // 注意：由于现在是div，可能没有disabled属性，暂时移除disabled判断，直接点击。
        // 如果需要更严谨的判断，需要用户提供更多信息来识别签到状态。
        console.log('Clicking check-in button...');
        await page.click(checkinButtonSelector);
        // 签到后通常会有弹窗或页面变化，等待一下
            await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒，观察弹窗或提示
        console.log('Check-in button clicked.');

        // 再次检查是否有“服务尚未到期，无需签到”的提示
        const currentStatus = await page.evaluate(() => {
            const messageElement = document.querySelector('div.layui-layer-content'); // 根据用户提供的信息更新提示文本选择器
            return messageElement ? messageElement.innerText : 'No toast message found.';
        });
        console.log(`Check-in result/toast: ${currentStatus}`);

        console.log('Taking a screenshot...');
        await page.screenshot({ path: 'checkin_result.png' });
        console.log('Screenshot saved as checkin_result.png');

    } catch (error) {
        console.error('An error occurred during automation:', error);
        // 如果出现错误，也尝试截屏，以便调试
        if (browser) {
            const page = (await browser.pages())[0]; // 获取当前页面
            if (page) {
                await page.screenshot({ path: 'error_screenshot.png' });
                console.log('Error screenshot saved as error_screenshot.png');
            }
        }
        process.exit(1); // 退出并带有错误码
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

autoCheckIn();
