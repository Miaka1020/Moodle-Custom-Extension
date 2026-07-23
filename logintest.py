from flask import Flask, redirect, url_for, session, render_template_string
from authlib.integrations.flask_client import OAuth
import os

app = Flask(__name__)
app.secret_key = os.urandom(24) # セッション暗号化用のランダムキー

# 1. OAuthの設定
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id='【あなたのクライアントID】.apps.googleusercontent.com',
    client_secret='【あなたのクライアントシークレット】',
    access_token_url='https://googleapis.com',
    access_token_params=None,
    authorize_url='https://google.com',
    authorize_params=None,
    api_base_url='https://googleapis.com',
    userinfo_endpoint='https://googleapis.com',
    client_kwargs={'scope': 'openid email profile'},
    server_metadata_url='https://google.com'
)

# 2. トップ画面（ログイン前・ログイン後の表示切り替え）
@app.route('/')
def index():
    user = session.get('user')
    if user:
        # ログイン成功時の画面
        return render_template_string('''
            <h1>ログイン成功！</h1>
            <p>こんにちは、{{ user['name'] }} さん（{{ user['email'] }}）</p>
            <img src="{{ user['picture'] }}" width="100"><br><br>
            <a href="/logout"><button>ログアウト</button></a>
        ''', user=user)
    
    # 未ログイン時の画面（Googleログインボタンを表示）
    return '<h1>マイシステム</h1><a href="/login"><button>Googleアカウントでログイン</button></a>'

# 3. Googleのログイン画面へリダイレクト
@app.route('/login')
def login():
    redirect_uri = url_for('auth', _external=True)
    return google.authorize_redirect(redirect_uri)

# 4. Google認証後のコールバック処理（ユーザー情報の受け取り）
@app.route('/login/callback')
def auth():
    token = google.authorize_access_token()
    resp = google.get('userinfo')
    user_info = resp.json()
    
    # セッションにユーザー情報を保存
    session['user'] = user_info
    return redirect('/')

# 5. ログアウト処理
@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect('/')

if __name__ == '__main__':
    # テスト環境用にHTTP通信を一時的に許可（本番環境ではHTTPS必須）
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
    app.run(host='0.0.0.0', port=5000, debug=True)
