package com.contractparcel.helper;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Telephony;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * 제안서 그림(JPEG)을 문자(MMS)나 다른 앱으로 보내는 기능.
 * - sendSms: 기본 문자 앱을 받는 사람 번호·그림·짧은 글이 채워진 상태로 연다.
 *            (보내기 버튼은 사용자가 직접 누름)
 * - share  : 그림을 공유 창(카카오톡·문자·메일 등)으로 보낸다.
 * 그림은 앱 캐시 폴더에만 잠깐 저장하고 FileProvider로 받는 앱에 읽기 권한만 준다.
 */
@CapacitorPlugin(name = "ProposalShare")
public class ProposalSharePlugin extends Plugin {

    private Uri writeImage(String base64) throws Exception {
        if (base64 == null || base64.isEmpty()) throw new IllegalArgumentException("그림이 없습니다");
        int comma = base64.indexOf(',');
        if (base64.startsWith("data:") && comma > 0) base64 = base64.substring(comma + 1);
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        Context ctx = getContext();
        File dir = new File(ctx.getCacheDir(), "share");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("저장 폴더를 만들 수 없습니다");
        File file = new File(dir, "parcel-proposal.jpg");   // 일부 문자 앱이 한글 파일명을 못 받아 영문으로
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
        return FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
    }

    private Intent imageIntent(Uri uri, String text) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("image/jpeg");
        i.putExtra(Intent.EXTRA_STREAM, uri);
        i.setClipData(ClipData.newRawUri("", uri));
        if (text != null && !text.isEmpty()) {
            i.putExtra(Intent.EXTRA_TEXT, text);
            i.putExtra("sms_body", text);
        }
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return i;
    }

    @PluginMethod
    public void sendSms(PluginCall call) {
        try {
            Uri uri = writeImage(call.getString("image"));
            Intent i = imageIntent(uri, call.getString("text"));
            String phone = call.getString("phone");
            if (phone != null && !phone.isEmpty()) i.putExtra("address", phone);
            String smsApp = Telephony.Sms.getDefaultSmsPackage(getContext());
            if (smsApp != null) i.setPackage(smsApp);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(i);
            } catch (ActivityNotFoundException e) {
                // 기본 문자 앱이 그림 받기를 지원하지 않으면 공유 창으로
                i.setPackage(null);
                getActivity().startActivity(Intent.createChooser(i, "제안서 보내기"));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("문자 앱을 열 수 없습니다: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            Uri uri = writeImage(call.getString("image"));
            Intent i = imageIntent(uri, call.getString("text"));
            Intent chooser = Intent.createChooser(i, "제안서 공유");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("공유할 수 없습니다: " + e.getMessage(), e);
        }
    }
}
