# 编写子程序 abs_val(a0) 并调用两次，算出 t2 = |t0| + |t1|
mv   a0, t0
jal  ra, abs_val
mv   t2, a0
mv   a0, t1
jal  ra, abs_val
add  t2, t2, a0
j    done

abs_val:
bge  a0, zero, abs_done
sub  a0, zero, a0
abs_done:
ret

done:
ecall
