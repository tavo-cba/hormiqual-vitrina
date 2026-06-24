import { useEffect, useState } from 'react';
import axios from 'axios';
import { config } from '../../../config/config';

export default function useOptions(url, labelKey, valueKey, labelResolver = null) {
  const [opts, setOpts] = useState([]);

  useEffect(() => {
    axios.get(`${config.backendUrl}${url}`, { headers: config.headers })
      .then(r => setOpts(
        r.data.map(o => ({
          label: labelResolver ? labelResolver(o) : o[labelKey],
          value: o[valueKey]
        }))
      ))
      .catch(console.error);
  }, [url, labelKey, valueKey, labelResolver]);

  return opts;
}
