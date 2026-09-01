const { createClient } = require('../../zkteco-push-ta/node_modules/@supabase/supabase-js');
const dotenv = require('../../zkteco-push-ta/node_modules/dotenv');

const path = require('path');
dotenv.config({ path: path.join(__dirname, '../../zkteco-push-ta/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkTable() {
  const { data, error } = await supabase.from('audit_logs').select('*').limit(1);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Table audit_logs exists! Data:', data);
  }
}

checkTable();
